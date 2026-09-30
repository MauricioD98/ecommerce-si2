// Service Worker de Stella Femme: notificaciones Web Push + caché offline del catálogo/perfil/assets.
//
// Deliberadamente NO es un service worker generado por una librería (next-pwa/Workbox no funcionan
// con Turbopack, que es lo único que usa este proyecto en Next 16). Las estrategias de abajo son la
// versión a mano de NetworkFirst/StaleWhileRevalidate/CacheFirst: cada una son ~10 líneas con la
// Cache API nativa del navegador.
//
// Importante: solo se interceptan peticiones GET. Las mutaciones (POST /orders, /cart, /auth, etc.)
// nunca pasan por acá — la cola de pedidos offline la maneja la app explícitamente
// (utils/offlineOrderQueue.ts + hooks/useOfflineOrderSync.ts), nunca el service worker en silencio.

const CACHE_VERSION = 'v7';
const API_CACHE = `sf-api-${CACHE_VERSION}`;
const ASSET_CACHE = `sf-assets-${CACHE_VERSION}`;
const PAGE_CACHE = `sf-pages-${CACHE_VERSION}`;
const CURRENT_CACHES = [API_CACHE, ASSET_CACHE, PAGE_CACHE];

// Fallback de navegación: si una URL no cacheada falla por falta de red, se sirve esta página en
// vez del error nativo del navegador (ERR_FAILED). Se precachea en install() para que exista desde
// la primera visita, incluso si esa visita nunca llegó a cargar /offline por su cuenta.
const OFFLINE_URL = '/offline';
// Ruta estática a la que redirige el checkout cuando se guarda un pedido offline (nunca un id
// dinámico de orden: esa página no existiría en caché la primera vez que se visita sin red).
const OFFLINE_ORDER_SUCCESS_URL = '/checkout/offline-success';
const PRECACHE_URLS = ['/', OFFLINE_URL, OFFLINE_ORDER_SUCCESS_URL, '/cart'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(PAGE_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => undefined) // best-effort: si falla alguna ruta, no bloquea la instalación
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Limpia cachés de versiones anteriores (si CACHE_VERSION cambia en un deploy futuro)
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('sf-') && !CURRENT_CACHES.includes(key))
            .map((key) => caches.delete(key)),
        ),
      ),
    ]),
  );
});

// El cliente (useAuth().logout() o sincronizador) manda esto para limpiar caché de API
self.addEventListener('message', (event) => {
  if (event.data?.type === 'CLEAR_USER_CACHE' || event.data?.type === 'CLEAR_API_CACHE') {
    event.waitUntil(caches.delete(API_CACHE));
  }
});

// Respuesta real (no Response.error()) para peticiones internas del router de Next/Turbopack.
function controlledFailureResponse() {
  return new Response(JSON.stringify({ error: 'offline' }), {
    status: 503,
    statusText: 'Offline',
    headers: { 'Content-Type': 'application/json' },
  });
}

// NetworkFirst: intenta la red primero (datos frescos de stock/precios); si falla la red (offline),
// cae a la última copia en caché para mantener la app utilizable sin conexión.
async function networkFirst(request, cacheName, onMiss) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request, { cache: 'no-cache' });
    if (response && (response.ok || response.type === 'opaque')) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreVary: true });
    if (cached) return cached;
    return onMiss ? onMiss() : Response.error();
  }
}

// StaleWhileRevalidate: responde de caché al instante (si existe) y actualiza en segundo plano.
async function staleWhileRevalidate(request, cacheName, onMiss) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreVary: true });
  const networkFetch = fetch(request)
    .then((response) => {
      if (response && (response.ok || response.type === 'opaque')) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return cached || (await networkFetch) || (onMiss ? onMiss() : Response.error());
}

// CacheFirst: para contenido inmutable (imágenes, fuentes, chunks hasheados de Next).
// Soporta respuestas opacas (type === 'opaque') necesarias para imágenes externas (Unsplash, CDN).
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && (response.ok || response.type === 'opaque')) cache.put(request, response.clone());
    return response;
  } catch {
    return request.destination === 'script' ? controlledFailureResponse() : Response.error();
  }
}

// NetworkFirst para navegación: intenta red primero (contenido fresco); si falla, cae a la última
// versión vista de esa misma URL; si tampoco existe en caché, sirve OFFLINE_URL.
async function navigateWithOfflineFallback(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreVary: true });
    if (cached) return cached;
    const offlinePage = await cache.match(OFFLINE_URL, { ignoreVary: true });
    return offlinePage || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Toda la API (catálogo, perfil, pedidos, sucursales...): puede ser cross-origin
  if (url.pathname.startsWith('/api/v1/')) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  // manifest.webmanifest / manifest.json
  if (url.pathname.endsWith('manifest.webmanifest') || url.pathname.endsWith('manifest.json')) {
    event.respondWith(staleWhileRevalidate(request, ASSET_CACHE));
    return;
  }

  // Imágenes (incluyendo hosts externos como Unsplash), fuentes, estilos y scripts
  const isImageFile = url.pathname.match(/\.(png|jpe?g|webp|svg|gif|ico|avif)(\?.*)?$/i);
  if (
    request.destination === 'image' ||
    Boolean(isImageFile) ||
    request.destination === 'font' ||
    request.destination === 'script' ||
    request.destination === 'style' ||
    url.pathname.startsWith('/_next/static/')
  ) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  // Peticiones internas del router de Next para navegación del lado del cliente (RSC flight data)
  if (request.headers.has('rsc') || url.pathname.includes('/_next/data/')) {
    event.respondWith(staleWhileRevalidate(request, PAGE_CACHE, controlledFailureResponse));
    return;
  }

  // Navegación (cargar una página completa)
  if (request.mode === 'navigate') {
    event.respondWith(navigateWithOfflineFallback(request, PAGE_CACHE));
  }
});

self.addEventListener('push', (event) => {
  let data = { title: 'Stella Femme', body: 'Tienes una notificación nueva.' };
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { title: 'Stella Femme', body: event.data.text() };
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/favicon.ico',
    badge: data.icon || '/favicon.ico',
    data: { url: data.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(data.title || 'Stella Femme', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if (client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    }),
  );
});
