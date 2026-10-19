// LakTrak: show Web Push notifications and open the app when one is tapped.
// Imported into the generated service worker (vite.config.ts → workbox.importScripts).
self.addEventListener('push', (event) => {
  let m = {};
  try { m = event.data ? event.data.json() : {}; } catch { m = { title: 'LakTrak', body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(m.title || 'LakTrak', {
    body: m.body || '', tag: m.tag || 'laktrak', renotify: true,
    icon: 'icons/icon-192.png', data: { url: m.url || '#/home' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(self.registration.scope + ((event.notification.data && event.notification.data.url) || '#/home')).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) { await w.focus(); return w.navigate(target); }
    }
    return self.clients.openWindow(target);
  })());
});
