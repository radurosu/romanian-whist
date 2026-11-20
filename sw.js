const CACHE = 'wist-v37';
const ASSETS = ['./', './index.html', './multiplayer.html', './manifest.json', './icon-180.png', './table.html', './css/game.css', './css/table.css', './js/game-engine.js', './js/game-ui.js', './js/table-ui.js', './js/replay-worker.js'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' }))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Pages: network-first, so HTML changes reach devices without a cache-name
  // bump; fall back to the cached copy when offline. Cache keys are stored
  // without the query string so links like index.html?players=4 or
  // multiplayer.html?join=XXXX still resolve offline.
  // Own scripts and styles: network-first too. Cache-first kept serving the
  // old game-ui.js after a deploy, so UI changes never showed up.
  const own = new URL(req.url);
  if (req.mode !== 'navigate' && own.origin === self.location.origin && /\.(js|css)$/.test(own.pathname)) {
    event.respondWith(
      fetch(req, { cache: 'no-cache' }).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  if (req.mode === 'navigate') {
    const bare = req.url.split('#')[0].split('?')[0];
    event.respondWith(
      fetch(req).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(bare, copy));
        }
        return res;
      }).catch(() =>
        caches.match(bare).then(cached => cached || caches.match('./index.html'))
      )
    );
    return;
  }

  // Google Fonts: cache on first use so the table keeps its typefaces offline.
  if (/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(req.url)) {
    event.respondWith(
      caches.open(CACHE).then(cache => cache.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
        return res;
      })))
    );
    return;
  }

  // Everything else (manifest, CDN scripts): cache-first, network fallback.
  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req))
  );
});
