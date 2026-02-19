/* ===== Service Worker – AKZ Tracker ===== */

var CACHE_NAME = 'akz-tracker-v33';
var SHELL_URLS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/map.js',
  '/js/boats.js',
  '/js/expedition.js',
  '/js/playback.js',
  '/js/tracker.js',
  '/js/websocket.js',
  '/js/admin.js',
  '/js/app.js',
  '/manifest.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

// ---------- Install: pre-cache app shell ----------
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(SHELL_URLS);
    })
  );
  self.skipWaiting();
});

// ---------- Activate: clean old caches ----------
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names
          .filter(function (n) { return n !== CACHE_NAME; })
          .map(function (n) { return caches.delete(n); })
      );
    })
  );
  self.clients.claim();
});

// ---------- Fetch strategy ----------
self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);

  // API calls: network-first, fall back to cache
  // Expedition track data: network-only (too large to cache)
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname.indexOf('/track') !== -1) {
      event.respondWith(fetch(event.request));
      return;
    }
    event.respondWith(
      fetch(event.request)
        .then(function (response) {
          // Cache a clone of the successful GET response (don't cache POST/PUT/DELETE)
          if (event.request.method === 'GET') {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(event.request, clone);
            });
          }
          return response;
        })
        .catch(function () {
          return caches.match(event.request);
        })
    );
    return;
  }

  // OpenSeaMap tiles: cache-first (opportunistic caching)
  if (url.hostname === 'tiles.openseamap.org') {
    event.respondWith(
      caches.match(event.request).then(function (cached) {
        if (cached) return cached;
        return fetch(event.request).then(function (response) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, clone);
          });
          return response;
        });
      })
    );
    return;
  }

  // Everything else (shell assets): cache-first
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      return cached || fetch(event.request);
    })
  );
});
