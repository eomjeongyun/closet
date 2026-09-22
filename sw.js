'use strict';

const CACHE_NAME = 'closet-v1';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './fonts/memomentKkukKkuk.woff2',
  './fonts/Pretendard-Regular.woff2',
  './fonts/Pretendard-SemiBold.woff2',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME && key.startsWith('closet-')).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // the background-removal engine (~56MB) never changes once downloaded: cache-first, never re-fetched in the background.
  if (url.pathname.includes('/onnx/')) {
    event.respondWith(caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
        return response;
      });
    }));
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(caches.match('./index.html').then(cached => {
      const fresh = fetch(new Request('./index.html', { cache: 'no-cache' })).then(response => {
        if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put('./index.html', response.clone()));
        return response;
      }).catch(() => cached);
      event.waitUntil(fresh.then(() => {}).catch(() => {}));
      return cached || fresh;
    }));
    return;
  }

  event.respondWith(caches.match(event.request).then(cached => {
    const refresh = fetch(new Request(event.request.url, { cache: 'no-cache' })).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
      return response;
    }).catch(() => null);
    if (cached) {
      event.waitUntil(refresh);
      return cached;
    }
    return refresh.then(response => response || new Response('', { status: 503 }));
  }));
});
