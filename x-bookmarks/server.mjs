// X Bookmarks Reader — zero-dependency Node.js server (Node 18+).
// Handles OAuth 2.0 PKCE login with X, syncs bookmarks via the v2 API,
// caches them locally, and serves the reader UI from ./public.

import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(ROOT, 'data');
const TOKENS_FILE = join(DATA_DIR, 'tokens.json');
const BOOKMARKS_FILE = join(DATA_DIR, 'bookmarks.json');
const PUBLIC_DIR = join(ROOT, 'public');

loadDotEnv(join(ROOT, '.env'));

const PORT = Number(process.env.PORT || 8787);
const CLIENT_ID = process.env.X_CLIENT_ID || '';
const CLIENT_SECRET = process.env.X_CLIENT_SECRET || ''; // only for "confidential" X apps
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const REDIRECT_URI = `${BASE_URL}/auth/callback`;
const SCOPES = 'tweet.read users.read bookmark.read offline.access';
const AUTH_URL = 'https://x.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.x.com/2/oauth2/token';
const API = 'https://api.x.com/2';

// In-memory PKCE state for pending logins: state -> code_verifier
const pendingLogins = new Map();
let syncInProgress = false;

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(path, value, secret = false) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2));
  if (secret) await chmod(path, 0o600).catch(() => {});
}

// ---------- OAuth ----------

function tokenRequestHeaders() {
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (CLIENT_SECRET) {
    headers.Authorization =
      'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  }
  return headers;
}

async function exchangeToken(params) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: tokenRequestHeaders(),
    body: new URLSearchParams({ client_id: CLIENT_ID, ...params }).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Token request failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

async function saveTokens(tokenResponse, extra = {}) {
  const tokens = {
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token || extra.refresh_token || null,
    expires_at: Date.now() + (tokenResponse.expires_in || 7200) * 1000,
    user: extra.user || null,
  };
  await writeJson(TOKENS_FILE, tokens, true);
  return tokens;
}

async function getValidTokens() {
  const tokens = await readJson(TOKENS_FILE, null);
  if (!tokens?.access_token) return null;
  if (Date.now() < tokens.expires_at - 60_000) return tokens;
  if (!tokens.refresh_token) return null;
  const refreshed = await exchangeToken({
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
  });
  return saveTokens(refreshed, { refresh_token: tokens.refresh_token, user: tokens.user });
}

async function xApi(path, accessToken) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.detail || body?.title || `X API error ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

// ---------- Bookmark normalization ----------

function normalizePage(page) {
  const users = new Map((page.includes?.users || []).map((u) => [u.id, u]));
  const media = new Map((page.includes?.media || []).map((m) => [m.media_key, m]));
  return (page.data || []).map((t) => {
    const author = users.get(t.author_id) || {};
    return {
      id: t.id,
      text: t.note_tweet?.text || t.text || '',
      created_at: t.created_at || null,
      lang: t.lang || null,
      author: {
        id: t.author_id || null,
        name: author.name || 'Unknown',
        username: author.username || null,
        profile_image_url: author.profile_image_url || null,
      },
      metrics: t.public_metrics || {},
      urls: (t.entities?.urls || [])
        .filter((u) => u.expanded_url && !u.expanded_url.startsWith('https://x.com/'))
        .map((u) => ({ short: u.url, expanded: u.expanded_url, display: u.display_url })),
      media: (t.attachments?.media_keys || [])
        .map((k) => media.get(k))
        .filter(Boolean)
        .map((m) => ({
          type: m.type,
          url: m.url || m.preview_image_url || null,
          alt: m.alt_text || null,
        })),
      url: author.username
        ? `https://x.com/${author.username}/status/${t.id}`
        : `https://x.com/i/status/${t.id}`,
    };
  });
}

async function syncBookmarks(tokens) {
  const userId = tokens.user?.id;
  if (!userId) throw new Error('No user id on file — reconnect your X account.');
  const params = new URLSearchParams({
    max_results: '100',
    'tweet.fields': 'created_at,public_metrics,entities,attachments,author_id,lang,note_tweet',
    expansions: 'author_id,attachments.media_keys',
    'user.fields': 'name,username,profile_image_url',
    'media.fields': 'type,url,preview_image_url,alt_text',
  });

  const fetched = [];
  let nextToken = null;
  let rateLimited = false;
  for (let pageNum = 0; pageNum < 100; pageNum++) {
    if (nextToken) params.set('pagination_token', nextToken);
    let page;
    try {
      page = await xApi(`/users/${userId}/bookmarks?${params}`, tokens.access_token);
    } catch (err) {
      if (err.status === 429 && fetched.length > 0) {
        rateLimited = true;
        break;
      }
      throw err;
    }
    fetched.push(...normalizePage(page));
    nextToken = page.meta?.next_token;
    if (!nextToken) break;
  }

  const store = await readJson(BOOKMARKS_FILE, { bookmarks: [] });
  const merged = new Map(store.bookmarks.map((b) => [b.id, b]));
  for (const b of fetched) merged.set(b.id, b);
  const bookmarks = [...merged.values()].sort((a, b) =>
    (b.created_at || '').localeCompare(a.created_at || '')
  );
  await writeJson(BOOKMARKS_FILE, { bookmarks, lastSync: new Date().toISOString() });
  return { fetched: fetched.length, total: bookmarks.length, rateLimited };
}

function normalizeImport(payload) {
  // Accepts: a normalized export from this app, a raw X API response page,
  // an array of pages, or a bare array of tweet objects.
  const pages = [];
  const looksLikePage = (o) => o && typeof o === 'object' && Array.isArray(o.data);
  if (looksLikePage(payload)) pages.push(payload);
  else if (Array.isArray(payload)) {
    if (payload.every(looksLikePage)) pages.push(...payload);
    else pages.push({ data: payload });
  } else if (Array.isArray(payload?.bookmarks)) {
    // Already-normalized export: pass through, keeping only known fields.
    return payload.bookmarks.filter((b) => b && b.id && typeof b.text === 'string');
  } else {
    throw new Error('Unrecognized JSON format.');
  }
  return pages.flatMap((p) => normalizePage(p));
}

// ---------- HTTP server ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function send(res, status, body, type = 'application/json') {
  const data = type === 'application/json' ? JSON.stringify(body) : body;
  res.writeHead(status, { 'Content-Type': type });
  res.end(data);
}

function readBody(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, BASE_URL);
  try {
    // --- Auth ---
    if (url.pathname === '/auth/login') {
      if (!CLIENT_ID) {
        return send(res, 500, { error: 'X_CLIENT_ID is not set. See README for setup.' });
      }
      const state = b64url(randomBytes(24));
      const verifier = b64url(randomBytes(48));
      pendingLogins.set(state, verifier);
      setTimeout(() => pendingLogins.delete(state), 10 * 60 * 1000).unref();
      const authorize = new URL(AUTH_URL);
      authorize.search = new URLSearchParams({
        response_type: 'code',
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        scope: SCOPES,
        state,
        code_challenge: b64url(createHash('sha256').update(verifier).digest()),
        code_challenge_method: 'S256',
      }).toString();
      res.writeHead(302, { Location: authorize.toString() });
      return res.end();
    }

    if (url.pathname === '/auth/callback') {
      const state = url.searchParams.get('state');
      const code = url.searchParams.get('code');
      const verifier = pendingLogins.get(state);
      pendingLogins.delete(state);
      if (!verifier || !code) {
        return send(res, 400, 'Login expired or was denied. <a href="/">Back</a>', MIME['.html']);
      }
      const tokenResponse = await exchangeToken({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      });
      const me = await xApi(
        '/users/me?user.fields=name,username,profile_image_url',
        tokenResponse.access_token
      );
      await saveTokens(tokenResponse, { user: me.data });
      res.writeHead(302, { Location: '/' });
      return res.end();
    }

    if (url.pathname === '/auth/logout' && req.method === 'POST') {
      await writeJson(TOKENS_FILE, {}, true);
      return send(res, 200, { ok: true });
    }

    // --- API ---
    if (url.pathname === '/api/status') {
      const tokens = await getValidTokens().catch(() => null);
      const store = await readJson(BOOKMARKS_FILE, { bookmarks: [] });
      return send(res, 200, {
        configured: Boolean(CLIENT_ID),
        authenticated: Boolean(tokens),
        user: tokens?.user || null,
        count: store.bookmarks.length,
        lastSync: store.lastSync || null,
      });
    }

    if (url.pathname === '/api/bookmarks') {
      const store = await readJson(BOOKMARKS_FILE, { bookmarks: [] });
      return send(res, 200, store);
    }

    if (url.pathname === '/api/sync' && req.method === 'POST') {
      if (syncInProgress) return send(res, 409, { error: 'A sync is already running.' });
      const tokens = await getValidTokens();
      if (!tokens) return send(res, 401, { error: 'Not connected to X. Log in first.' });
      syncInProgress = true;
      try {
        return send(res, 200, await syncBookmarks(tokens));
      } finally {
        syncInProgress = false;
      }
    }

    if (url.pathname === '/api/import' && req.method === 'POST') {
      const imported = normalizeImport(JSON.parse(await readBody(req)));
      const store = await readJson(BOOKMARKS_FILE, { bookmarks: [] });
      const merged = new Map(store.bookmarks.map((b) => [b.id, b]));
      for (const b of imported) merged.set(b.id, b);
      const bookmarks = [...merged.values()].sort((a, b) =>
        (b.created_at || '').localeCompare(a.created_at || '')
      );
      await writeJson(BOOKMARKS_FILE, { bookmarks, lastSync: store.lastSync || null });
      return send(res, 200, { imported: imported.length, total: bookmarks.length });
    }

    // --- Static files ---
    let filePath = url.pathname === '/' ? '/index.html' : normalize(url.pathname);
    if (filePath.includes('..')) return send(res, 400, { error: 'Bad path' });
    const full = join(PUBLIC_DIR, filePath);
    if (existsSync(full)) {
      return send(res, 200, await readFile(full), MIME[extname(full)] || 'application/octet-stream');
    }
    return send(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(`[${req.method} ${url.pathname}]`, err.message);
    return send(res, err.status === 429 ? 429 : 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`X Bookmarks Reader running at ${BASE_URL}`);
  if (!CLIENT_ID) {
    console.log('⚠  X_CLIENT_ID is not set — login is disabled until you configure it (see README).');
  }
});
