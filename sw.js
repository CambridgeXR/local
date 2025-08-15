// sw.js
const VERSION = '6'; // bump this for each deploy
const CACHE = `360-vr-player-cache-v${VERSION}`;

// Append version query to all shell assets
const APP_SHELL = [
  './',
  './?source=pwa',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png'
].map(url => `${url}${url.includes('?') ? '&' : '?'}v=${VERSION}`);

// Install: precache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches + enable navigation preload
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try { await self.registration.navigationPreload?.enable(); } catch {}
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k !== CACHE ? caches.delete(k) : null)));
    await self.clients.claim();
  })());
});

// Allow page to trigger an immediate update
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// Fetch: smarter strategies
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only GET is cacheable
  if (req.method !== 'GET') return;

  // 1) Navigations: network-first with offline fallback to app shell
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const preload = await event.preloadResponse;
        if (preload) return preload;
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put('./', fresh.clone());
        return fresh;
      } catch {
        const cache = await caches.open(CACHE);
        return (await cache.match('./')) ||
               (await cache.match('./index.html')) ||
               (await cache.match('/index.html')) ||
               Response.error();
      }
    })());
    return;
  }

  // 2) Don’t intercept byte-range/media or blob/filesystem (video playback, local files)
  if (req.headers.has('range') || url.protocol === 'blob:' || url.protocol === 'filesystem:') {
    return; // let browser handle it directly
  }

  // 3) Same-origin static assets: cache-first
  if (url.origin === location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  // 4) CDN (e.g., jsDelivr for three.js): stale-while-revalidate
  if (url.hostname.endsWith('cdn.jsdelivr.net')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      const fetchPromise = fetch(req).then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => undefined);
      return cached || fetchPromise || fetch(req);
    })());
  }
});
