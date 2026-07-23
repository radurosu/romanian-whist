const CACHE = 'wist-v24';
const ASSETS = ['./', './index.html', './multiplayer.html', './manifest.json', './icon-180.png'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
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

  // Everything else (manifest, CDN scripts): cache-first, network fallback.
  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req))
  );
});
