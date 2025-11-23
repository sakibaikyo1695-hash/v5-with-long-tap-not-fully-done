// Offline support for app shell + any map tiles you view while online.
// Tiles you looked at preflight remain available in the air.

const VERSION = 'v1';
const APP_CACHE = `app-${VERSION}`;
const TILE_CACHE = `tiles-${VERSION}`;
const APP_ASSETS = [
  './',
  './index.html',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

// keep tile cache from growing forever
const MAX_TILE_ENTRIES = 2000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then(cache => cache.addAll(APP_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => {
      if (k !== APP_CACHE && k !== TILE_CACHE) return caches.delete(k);
    }));
    if ('navigationPreload' in self.registration) {
      try { await self.registration.navigationPreload.enable(); } catch {}
    }
  })());
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Navigations: try network, fall back to cached index
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const preload = await event.preloadResponse;
        if (preload) return preload;
        return await fetch(req);
      } catch {
        const cache = await caches.open(APP_CACHE);
        return (await cache.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  // App assets: network first, fallback cache
  if (APP_ASSETS.some(a => req.url.startsWith(a) || req.url === a)) {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        const cache = await caches.open(APP_CACHE);
        cache.put(req, net.clone());
        return net;
      } catch {
        const cache = await caches.open(APP_CACHE);
        const cached = await cache.match(req);
        if (cached) return cached;
        throw new Error('Asset not cached');
      }
    })());
    return;
  }

  // OSM tiles user views (cache-as-you-go)
  const isOSMTile = /https:\/\/[abc]\.tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png/.test(req.url);
  if (isOSMTile) {
    event.respondWith((async () => {
      const cache = await caches.open(TILE_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const net = await fetch(req, { mode: 'cors', credentials: 'omit' });
        await cache.put(req, net.clone());
        trimCache(cache, MAX_TILE_ENTRIES);
        return net;
      } catch {
        // no tile cached: nothing to show; return generic error
        return Response.error();
      }
    })());
    return;
  }

  // Default
  event.respondWith((async () => {
    try { return await fetch(req); }
    catch {
      const cache = await caches.open(APP_CACHE);
      return (await cache.match(req)) || Response.error();
    }
  })());
});

async function trimCache(cache, maxItems) {
  const keys = await cache.keys();
  const extra = keys.length - maxItems;
  if (extra > 0) {
    for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
  }
}
