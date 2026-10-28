/* Wifey & Hubby: push-only service worker. No page caches, no visual changes. */
self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : '' }; }
  // Apple requires all received pushes to produce a visible notification.
  const title = String(data.title || 'Wifey & Hubby');
  const body = String(data.body || 'A calendar reminder is ready.');
  event.waitUntil(self.registration.showNotification(title, {
    body,
    tag: String(data.tag || 'wifey-hubby-reminder'),
    icon: './assets/icon-192.png',
    badge: './assets/icon-192.png',
    data: { url: './index.html' }
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = new URL('./index.html', self.registration.scope).href;
    const clientsList = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
    for (const client of clientsList) {
      if (client.url.startsWith(self.registration.scope)) {
        await client.focus();
        client.postMessage({ type: 'OPEN_CALENDAR' });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
