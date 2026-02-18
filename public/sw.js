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
  const buildNotificationFromPayload = (payload) => {
    const notification = payload?.notification || {};
    const data = payload?.data || {};
    const title = notification.title || data.title || 'Medication Reminder';
    const body = notification.body || data.body || 'You have a due medication.';
    const isAlarm = data.alarm === '1' || data.type === 'medication_reminder';

    const options = {
      body,
      icon: notification.icon || '/icons/icon-192.svg',
      badge: notification.badge || '/icons/icon-192.svg',
      tag: notification.tag || (data.reminderKey ? `pillcare_${data.reminderKey}` : 'pillcare_reminder'),
      renotify: true,
      requireInteraction: isAlarm || Boolean(notification.requireInteraction),
      vibrate: isAlarm ? [260, 120, 260, 120, 420] : [180, 120, 180],
      actions: [{ action: 'open', title: 'Open PillCare' }],
      data: {
        ...data,
        link: data.link || '/#/'
      }
    };

    if ('silent' in notification) {
      options.silent = notification.silent;
    }

    return { title, options };
  };

  messaging.onBackgroundMessage((payload) => {
    const { title, options } = buildNotificationFromPayload(payload || {});
    self.registration.showNotification(title, options);
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

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = {
      notification: {
        title: 'Medication Reminder',
        body: event.data.text()
      }
    };
  }

  const notification = payload.notification || {};
  const data = payload.data || {};
  const isAlarm = data.alarm === '1' || data.type === 'medication_reminder';
  const title = notification.title || data.title || 'Medication Reminder';
  const body = notification.body || data.body || 'You have a due medication.';

  const options = {
    body,
    icon: notification.icon || '/icons/icon-192.svg',
    badge: notification.badge || '/icons/icon-192.svg',
    tag: notification.tag || (data.reminderKey ? `pillcare_${data.reminderKey}` : 'pillcare_reminder'),
    renotify: true,
    requireInteraction: isAlarm || Boolean(notification.requireInteraction),
    vibrate: isAlarm ? [260, 120, 260, 120, 420] : [180, 120, 180],
    actions: [{ action: 'open', title: 'Open PillCare' }],
    data: {
      ...data,
      link: data.link || '/#/'
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetPath = event.notification?.data?.link || '/#/';
  const targetUrl = new URL(targetPath, self.location.origin).toString();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        const sameAppWindow = client.url.startsWith(self.location.origin);
        if (sameAppWindow && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
