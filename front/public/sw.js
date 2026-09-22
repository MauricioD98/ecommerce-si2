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

const CACHE_VERSION = 'v3';
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

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(PAGE_CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL, OFFLINE_ORDER_SUCCESS_URL]))
      .catch(() => undefined) // best-effort: si falla (ej. build todavía no las sirve), no bloquea la instalación
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

// El cliente (useAuth().logout()) manda esto al cerrar sesión. api-cache puede tener respuestas de
// endpoints con datos de UNA persona (perfil, pedidos) — el Cache API las guarda solo por URL, sin
// distinguir de quién son. Sin este borrado, en un dispositivo compartido la siguiente persona que
// inicia sesión podría ver, por una fracción de segundo (StaleWhileRevalidate sirve lo cacheado
// antes de que la red responda) u offline del todo, los datos de la cuenta anterior.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'CLEAR_USER_CACHE') {
    event.waitUntil(caches.delete(API_CACHE));
  }
});

// Respuesta real (no Response.error()) para peticiones internas del router de Next/Turbopack.
// Diferencia clave: fetch() SE RESUELVE con esto (aunque sea un error), nunca rechaza. Un
// Response.error() en cambio hace que fetch() rechace con un TypeError "Failed to fetch" sin
// atrapar — eso es lo que dispara el overlay/crash. El código de Next que pidió estos datos puede
// inspeccionar response.ok/response.status y decidir con calma en vez de recibir una excepción.
function controlledFailureResponse() {
  return new Response(JSON.stringify({ error: 'offline' }), {
    status: 503,
    statusText: 'Offline',
    headers: { 'Content-Type': 'application/json' },
  });
}

// StaleWhileRevalidate: responde de caché al instante (si existe) y actualiza en segundo plano.
// `onMiss` es qué devolver si no hay caché Y falla la red (por defecto, Response.error() — falla de
// red real, correcta para peticiones de datos porque axios/fetch la traduce en un error atrapable
// por los .catch() de los hooks; para las peticiones RSC del router se le pasa
// controlledFailureResponse en su lugar, ver más abajo).
async function staleWhileRevalidate(request, cacheName, onMiss) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkFetch = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return cached || (await networkFetch) || (onMiss ? onMiss() : Response.error());
}

// CacheFirst: para contenido inmutable (imágenes, fuentes, chunks hasheados de Next). Nunca vuelve
// a pedirse por red una vez cacheado.
//
// Importante: si no está en caché y falla la red (offline), NUNCA se debe devolver el HTML de
// /offline acá — un <script src> esperando JS que recibe HTML revienta con un SyntaxError en vez
// de fallar limpio. Response.error() es una respuesta "de red fallida" sin cuerpo: el navegador la
// trata igual que cualquier carga de recurso caída (el <script>/<img>/<link> dispara su onerror
// normal), que es exactamente lo que React/Next ya saben manejar.
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    // Los scripts (chunks de Turbopack) pasan por el runtime de carga de módulos de Next, que sabe
    // reaccionar a una respuesta con status de error; una respuesta real evita el "Failed to fetch"
    // sin atrapar que sí produce Response.error(). Para imágenes/fuentes no importa (el navegador
    // ya maneja su onerror igual con cualquiera de las dos), así que se deja Response.error() ahí.
    return request.destination === 'script' ? controlledFailureResponse() : Response.error();
  }
}

// NetworkFirst para navegación: intenta red primero (contenido fresco); si falla, cae a la última
// versión vista de esa misma URL; si tampoco existe en caché (nunca se visitó online), sirve
// OFFLINE_URL en vez de dejar que el navegador muestre su error nativo (ERR_FAILED).
async function navigateWithOfflineFallback(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    const offlinePage = await cache.match(OFFLINE_URL);
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

  // Toda la API (catálogo, perfil, pedidos, sucursales...): puede ser cross-origin (la API vive en
  // otro host/puerto que el frontend en dev), por eso se filtra por pathname y no por origin.
  // StaleWhileRevalidate: si la vio online, queda disponible offline (catálogo, "Mi cuenta",
  // "Mis pedidos"); si nunca la vio, Response.error() -> axios lo recibe como error de red y cada
  // hook ya lo atrapa y muestra "No podemos cargar esta información sin conexión a Internet."
  // (service/api/error.utils.ts). Ver el listener "message" arriba: esta caché se borra al cerrar
  // sesión para no filtrar datos de una cuenta a la siguiente en un dispositivo compartido.
  if (url.pathname.startsWith('/api/v1/')) {
    event.respondWith(staleWhileRevalidate(request, API_CACHE));
    return;
  }

  // manifest.webmanifest: a diferencia de los chunks de _next/static, esta URL NO tiene contenido
  // hasheado/inmutable (es un nombre fijo), así que sí le sirve revalidar en segundo plano en vez
  // de quedar pegada a la primera copia para siempre
  if (url.pathname.endsWith('manifest.webmanifest') || url.pathname.endsWith('manifest.json')) {
    event.respondWith(staleWhileRevalidate(request, ASSET_CACHE));
    return;
  }

  // Imágenes (incluye las de dominios externos: Unsplash, Bing, etc. — el catálogo las trae así),
  // fuentes y JS/CSS de Next (_next/static, y cualquier script/style por su `destination` aunque no
  // matchee ese prefijo): contenido con hash en el nombre de archivo, o sea inmutable.
  // CacheFirst (no StaleWhileRevalidate) a propósito: si el hash no cambió, el contenido tampoco, y
  // revalidarlo en cada visita sería una petición de red desperdiciada para un archivo que nunca
  // puede haber cambiado.
  if (
    request.destination === 'image' ||
    request.destination === 'font' ||
    request.destination === 'script' ||
    request.destination === 'style' ||
    url.pathname.startsWith('/_next/static/')
  ) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  // Peticiones internas del router de Next para navegación del lado del cliente (RSC flight data
  // del App Router, identificadas por el header `RSC`, o /_next/data/ del Pages Router).
  // StaleWhileRevalidate igual que el resto: si la ruta ya se visitó online, su RSC queda cacheado y
  // la transición de cliente funciona offline. Si nunca se visitó, no hay nada que servir — ahí es
  // importante NO usar Response.error() (rechaza el fetch del router sin atrapar, provoca el
  // crash/overlay) sino controlledFailureResponse(): el fetch se resuelve con un 503 que el propio
  // manejo de errores de Next/nuestro Error Boundary sí puede procesar con calma.
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
