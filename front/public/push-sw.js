// Service worker SOLO de notificaciones push. Se registra una vez por tienda con su propio scope
// (/push-scope/<tenantId>/, ver hooks/usePushNotifications.ts), así que:
//   - Dos tiendas abiertas en el mismo origen (localhost:3000, el host de la plataforma) tienen cada
//     una su propia suscripción, firmada con su propio par VAPID. Con una sola registración en "/"
//     el navegador tiene UNA suscripción y activar push en una tienda borraba la de la otra.
//   - No controla ninguna página (ninguna vive bajo ese scope) y no intercepta fetch: no cachea nada.
//     Por eso puede quedar registrado en desarrollo, donde el sw.js de caché offline se elimina en
//     cada carga (useRegisterServiceWorker) y se llevaba la suscripción con él.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = { title: 'Stella Femme', body: 'Tienes una notificación nueva.' };
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { title: 'Stella Femme', body: event.data.text() };
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'Stella Femme', {
      body: data.body,
      icon: data.icon || '/pwa-icon/192',
      badge: data.icon || '/pwa-icon/192',
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // El backend agrega ?tenant=<id> a la URL: abre la tienda correcta aunque la pestaña esté en otra
  const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if (client.url === targetUrl && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow ? self.clients.openWindow(targetUrl) : undefined;
    }),
  );
});
