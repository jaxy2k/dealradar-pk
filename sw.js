/* DealRadar PK Service Worker — v4
 * Rules:
 *  - All paths are relative (works on GitHub Pages project subpaths like /dealradar-pk/
 *    and on custom domains). Root-absolute paths broke install under a project page.
 *  - Static shell: network-first, cache as offline fallback. Fresh deploys win
 *    immediately; the cache only answers when the network fails.
 *  - Data files (live_deals.json / deals.json / health.json): network-first too —
 *    offers must never come from an aggressive cache. Cached copy = offline fallback only.
 *  - Cross-origin requests (Supabase API etc.) are NEVER intercepted — always live.
 *  - Precache uses allSettled so one missing asset can never abort SW installation.
 */
const CACHE_NAME = 'dealradar-v4';
const SHELL = ['./', './index.html', './app.js', './styles.css', './manifest.json', './icon-192.png', './icon-512.png'];
const DATA = ['./live_deals.json', './deals.json', './health.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled([...SHELL, ...DATA].map(u => cache.add(u)))
    ).then(() => {
      // First-ever install: take over immediately so offline works from day one.
      // Updates: stay "waiting" until the page sends SKIP_WAITING (user tapped Update).
      if (!self.registration.active) return self.skipWaiting();
    })
  );
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Same-origin only: Supabase / any external API goes straight to the network.
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(e.request).then(response => {
      if (response.ok) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
      }
      return response;
    }).catch(() =>
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        // Offline fallback for navigations -> cached app shell (shows last deals).
        if (e.request.mode === 'navigate' || (e.request.headers.get('accept') || '').includes('text/html')) {
          return caches.match('./index.html');
        }
        return Response.error();
      })
    )
  );
});

// Push notifications for deal expiry alerts
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  const icon = new URL('icon-192.png', self.location).href; // scope-safe
  e.waitUntil(
    self.registration.showNotification(data.title || 'DealRadar PK', {
      body: data.body || 'A deal you saved is about to expire!',
      icon,
      badge: icon,
      vibrate: [100, 50, 100]
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      if (clients.length > 0) return clients[0].focus();
      return self.clients.openWindow('./');
    })
  );
});
