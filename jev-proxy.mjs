#!/usr/bin/env node
/**
 * Local static server + TypeSafe proxy.
 * Holds TYPESAFE_API_KEY on the server so the browser never needs CORS
 * against api.typesafe.ai.
 *
 *   node jev-proxy.mjs
 *   open http://127.0.0.1:8787/
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.JEV_PROXY_PORT || '8787', 10);
const UPSTREAM = 'https://api.typesafe.ai/v1/systemone';

function loadKey() {
  if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY.trim();
  try {
    const text = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    const m = text.match(/^TYPESAFE_API_KEY=(.*)$/m);
    return m ? m[1].trim() : '';
  } catch {
    return '';
  }
}

const KEY = loadKey();
const ALLOWED_ORIGINS = new Set([
  `http://127.0.0.1:${PORT}`,
  `http://localhost:${PORT}`,
]);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};
const DENY = new Set(['.env', '.env.example', 'local-secrets.js', 'CLAUDE.md', '.gitignore', '.firebaseignore']);

function originAllowed(req) {
  const origin = req.headers.origin;
  if (origin) return ALLOWED_ORIGINS.has(origin);
  const host = req.headers.host || '';
  return host === `127.0.0.1:${PORT}` || host === `localhost:${PORT}`;
}

function cors(req) {
  const origin = req.headers.origin;
  const headers = { Vary: 'Origin' };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET,POST,OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Authorization,Content-Type';
  }
  return headers;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const headers = cors(req);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, headers);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname === '/jev-status' && req.method === 'GET') {
    res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: !!KEY, model: 'jev-latest' }));
    return;
  }

  if (url.pathname === '/v1/systemone' && req.method === 'POST') {
    if (!originAllowed(req)) {
      res.writeHead(403, { ...headers, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'origin not allowed' }));
      return;
    }
    if (!KEY) {
      res.writeHead(503, { ...headers, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'TYPESAFE_API_KEY missing in .env' }));
      return;
    }
    try {
      const body = await readBody(req);
      const up = await fetch(UPSTREAM, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${KEY}`,
          'Content-Type': 'application/json',
        },
        body,
      });
      const text = await up.text();
      res.writeHead(up.status, { ...headers, 'Content-Type': 'application/json' });
      res.end(text);
    } catch (e) {
      res.writeHead(502, { ...headers, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, headers);
    res.end();
    return;
  }

  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const base = path.basename(rel);
  if (DENY.has(base) || rel.includes('..') || rel.startsWith('/.')) {
    res.writeHead(404, headers);
    res.end('not found');
    return;
  }
  const fp = path.join(__dirname, rel);
  if (!fp.startsWith(__dirname)) {
    res.writeHead(403, headers);
    res.end();
    return;
  }
  fs.readFile(fp, (err, data) => {
    if (err) {
      res.writeHead(404, headers);
      res.end('not found');
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    if (req.method === 'HEAD') res.end();
    else res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  if (!KEY) console.warn('No TYPESAFE_API_KEY in .env — /v1/systemone will 503');
  console.log(`Romanian Whist + Jev  http://127.0.0.1:${PORT}/`);
});
