// Notifications while Wifey & Hubby is open; background push is not configured.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients => {
    for(const client of clients) if(client.url.startsWith(self.registration.scope)){await client.focus();return}
    if(self.clients.openWindow) await self.clients.openWindow(self.registration.scope);
  }));
});
