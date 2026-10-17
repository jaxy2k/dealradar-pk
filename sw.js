/* DealRadar PK Service Worker — offline cache + push */
const CACHE_NAME = 'dealradar-v3';
const ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/styles.css',
  '/deals.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
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
  // Network-first: always try the live server, fall back to cache only offline.
  // (Cache-first previously pinned a stale app.js on users' phones.)
  e.respondWith(
    fetch(e.request).then(response => {
      if (response.ok && e.request.url.includes(self.location.origin)) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
      }
      return response;
    }).catch(() => caches.match(e.request).then(cached => cached || caches.match('/index.html')))
  );
});

// Push notifications for deal expiry alerts
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(data.title || 'DealRadar PK', {
      body: data.body || 'A deal you saved is about to expire!',
      icon: '/logos/easypaisa.png',
      badge: '/logos/easypaisa.png',
      vibrate: [100, 50, 100]
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      if (clients.length > 0) return clients[0].focus();
      return self.clients.openWindow('/');
    })
  );
});
