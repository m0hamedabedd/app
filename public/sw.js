/* global firebase */
try {
  importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js');

  firebase.initializeApp({
    apiKey: "AIzaSyBImg8pi8XAvvBNBL3_163DUFxYd-LqIbY",
    authDomain: "pillcaree-21f7b.firebaseapp.com",
    databaseURL: "https://pillcaree-21f7b-default-rtdb.firebaseio.com",
    projectId: "pillcaree-21f7b",
    storageBucket: "pillcaree-21f7b.firebasestorage.app",
    messagingSenderId: "649163877313",
    appId: "1:649163877313:web:f00ef64521c91ecff65d40",
    measurementId: "G-2JB29FMHNM"
  });

  const messaging = firebase.messaging();
  messaging.onBackgroundMessage((payload) => {
    const title = payload.notification?.title || 'Medication Reminder';
    const body = payload.notification?.body || 'You have a due medication.';
    const notificationOptions = {
      body,
      icon: payload.notification?.icon || '/icons/icon-192.svg',
      badge: '/icons/icon-192.svg',
      data: payload.data || {}
    };
    self.registration.showNotification(title, notificationOptions);
  });
} catch (e) {
  // Firebase messaging may be unavailable in unsupported browsers.
}

const CACHE_NAME = 'pillcare-cache-v2';
const PRECACHE_URLS = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', responseClone));
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, responseToCache));
        return response;
      });
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/#/');
      }
      return undefined;
    })
  );
});
