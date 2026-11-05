// Service Worker de Stella Femme: notificaciones Web Push + caché offline del catálogo PÚBLICO y de assets.
//
// Deliberadamente NO es un service worker generado por una librería (next-pwa/Workbox no funcionan
// con Turbopack, que es lo único que usa este proyecto en Next 16). Las estrategias de abajo son la
// versión a mano de NetworkFirst/StaleWhileRevalidate/CacheFirst: cada una son ~10 líneas con la
// Cache API nativa del navegador.
//
// Regla de seguridad: aquí solo se cachea lo que está en una LISTA PERMITIDA. Perfil, pedidos, pagos,
// comprobantes, administración, auth e inventario privado nunca entran a Cache Storage (la Cache API
// guardaría igual respuestas con Cache-Control: no-store: la exclusión tiene que estar acá). Solo se
// interceptan GET; las compras nunca pasan por el service worker. El catálogo guardado es una copia
// informativa: stock y precio offline no autorizan ningún checkout, eso lo decide el servidor.

const CACHE_VERSION = 'v9';
const API_CACHE = `sf-public-api-${CACHE_VERSION}`;
const ASSET_CACHE = `sf-assets-${CACHE_VERSION}`;
const PAGE_CACHE = `sf-pages-${CACHE_VERSION}`;
const CURRENT_CACHES = [API_CACHE, ASSET_CACHE, PAGE_CACHE];
// Assets de la versión anterior: pestañas abiertas con el build viejo todavía pueden pedir sus chunks.
// Las cachés de API y de páginas anteriores se borran siempre: podían contener datos privados.
const PREVIOUS_ASSET_CACHE = 'sf-assets-v8';
// La v8 cacheaba toda la API. Si está instalada no se espera a que cierren sus pestañas: mientras siga
// activa seguiría guardando respuestas privadas. No recarga ninguna página, solo reemplaza el worker.
const UNSAFE_LEGACY_CACHE = 'sf-api-v8';

const MAX_ASSET_ENTRIES = 300;
const MAX_API_ENTRIES = 200;

// Fallback genérico de navegación: sin datos de ninguna sesión
const OFFLINE_URL = '/offline';
const PRECACHE_URLS = [OFFLINE_URL, '/', '/cart', '/checkout/offline-success', '/checkout/drafts'];

// API pública, sin datos del usuario. La clave de caché incluye tienda, idioma y query (sucursal, página...)
const PUBLIC_API = [/^\/api\/v1\/products(\/[^/]+)?\/?$/, /^\/api\/v1\/categories(\/[^/]+)?\/?$/, /^\/api\/v1\/collections(\/[^/]+)?\/?$/, /^\/api\/v1\/branches\/?$/, /^\/api\/v1\/store\/?$/];

// Páginas públicas. Las demás (cuenta, panel, plataforma, auth, resultado de pago) van siempre a la red y sin
// conexión reciben el fallback genérico: nunca HTML o RSC de otra sesión.
const PUBLIC_PAGE = /^\/($|cart\/?$|checkout\/?$|checkout\/offline-success\/?$|checkout\/drafts\/?$|offline\/?$|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$)/;

// Una por una: una ruta que falle no deja sin /offline al resto (addAll es todo o nada).
async function precachePages(variant) {
  const cache = await caches.open(PAGE_CACHE);
  await Promise.allSettled(
    PRECACHE_URLS.map(async (path) => {
      const url = variant ? `${path}?tenant=${encodeURIComponent(variant.tenant)}` : path;
      const response = await fetch(url, { cache: 'reload', credentials: 'same-origin' });
      if (!response.ok) return;
      const html = await response.clone().text();
      await cache.put(pageKey(path, variant), response);
      await precacheChunks(html);
    }),
  );
}

// El HTML guardado no sirve sin sus chunks: sin red, esa página nunca descargada fallaría al hidratarse
async function precacheChunks(html) {
  const assets = await caches.open(ASSET_CACHE);
  const urls = new Set(html.match(/\/_next\/static\/[^"'\s\\)]+\.(?:js|css)/g) ?? []);
  await Promise.allSettled(
    [...urls].map(async (url) => {
      if (await assets.match(url)) return;
      const response = await fetch(url);
      if (response.ok) await assets.put(url, response);
    }),
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      await precachePages(await pageVariant());
      if (await caches.has(UNSAFE_LEGACY_CACHE)) await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('sf-') && !CURRENT_CACHES.includes(key) && key !== PREVIOUS_ASSET_CACHE)
            .map((key) => caches.delete(key)),
        ),
      ),
    ]),
  );
});

self.addEventListener('message', (event) => {
  const type = event.data?.type;
  if (type === 'PRECACHE' && event.data.tenant) {
    // En la primera visita el worker se instala antes de que la página sepa de qué tienda es: ella avisa
    event.waitUntil(precachePages({ tenant: event.data.tenant, locale: event.data.locale ?? '' }));
  } else if (type === 'SKIP_WAITING') {
    // Solo a pedido del usuario (aviso de actualización), nunca en medio de un pago
    self.skipWaiting();
  } else if (type === 'CLEAR_USER_CACHE' || type === 'CLEAR_API_CACHE') {
    // Cierre de sesión o cambio de tienda: fuera lo que dependa de esa identidad
    event.waitUntil(Promise.all([caches.delete(API_CACHE), caches.delete(PAGE_CACHE)]));
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

async function readCookie(name) {
  try {
    const cookie = await self.cookieStore?.get(name);
    return cookie?.value ?? null;
  } catch {
    return null;
  }
}

// HTML y RSC dependen de la tienda y del idioma, que viajan en cookies y no en la URL. Sin saber a qué
// tienda pertenece la respuesta no se cachea: es preferible perder la caché a servir la de otra tienda.
async function pageVariant() {
  const [ownDomain, chosen, locale] = await Promise.all([readCookie('sf_tenant'), readCookie('sf_store_tenant'), readCookie('NEXT_LOCALE')]);
  const tenant = ownDomain ?? chosen;
  return tenant ? { tenant, locale: locale ?? '' } : null;
}

function pageKey(pathOrUrl, variant) {
  const url = new URL(pathOrUrl, self.location.origin);
  if (variant) {
    url.searchParams.set('__sf_tenant', variant.tenant);
    url.searchParams.set('__sf_lang', variant.locale);
  }
  return url.toString();
}

// La Cache API indexa solo por URL: dos tiendas que piden /api/v1/products compartirían la entrada. La clave
// agrega tienda (x-tenant-id) e idioma (Accept-Language) como query ficticia, que nunca se envía a la red.
// Sin tienda → null → la respuesta no se cachea ni se sirve desde caché.
function apiCacheKey(request) {
  const tenantId = request.headers.get('x-tenant-id');
  if (!tenantId) return null;
  const url = new URL(request.url);
  url.searchParams.set('__sf_tenant', tenantId.toLowerCase());
  const lang = (request.headers.get('accept-language') || '').split(',')[0].trim().toLowerCase();
  if (lang) url.searchParams.set('__sf_lang', lang);
  return url.toString();
}

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - maxEntries)).map((key) => cache.delete(key)));
}

// NetworkFirst: intenta la red primero (datos frescos de stock/precios); si falla la red (offline),
// cae a la última copia pública para mantener el catálogo navegable sin conexión.
async function publicApiNetworkFirst(event, request) {
  const key = apiCacheKey(request);
  const cache = await caches.open(API_CACHE);
  try {
    const response = await fetch(request, { cache: 'no-cache' });
    if (key && response.ok) {
      await cache.put(key, response.clone());
      event.waitUntil(trimCache(API_CACHE, MAX_API_ENTRIES));
    }
    return response;
  } catch {
    const cached = key ? await cache.match(key, { ignoreVary: true }) : undefined;
    if (!cached) return Response.error();
    // Marca para que la interfaz pueda avisar que es una copia con fecha, no un dato vigente
    const headers = new Headers(cached.headers);
    headers.set('x-sf-offline-copy', cached.headers.get('date') ?? 'unknown');
    return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
  }
}

// CacheFirst: solo para contenido inmutable (chunks de Next con hash en el nombre).
async function immutableCacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = (await cache.match(request, { ignoreVary: true })) ?? (await (await caches.open(PREVIOUS_ASSET_CACHE)).match(request, { ignoreVary: true }));
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return request.destination === 'script' ? controlledFailureResponse() : Response.error();
  }
}

// StaleWhileRevalidate: imágenes y fuentes. Pueden cambiar con la misma URL (un logo), así que se refrescan
// en segundo plano y la caché tiene tope. Soporta respuestas opacas (imágenes externas: Unsplash, CDN).
async function assetStaleWhileRevalidate(event, request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request, { ignoreVary: true });
  const refresh = fetch(request)
    .then(async (response) => {
      if (response && (response.ok || response.type === 'opaque')) {
        await cache.put(request, response.clone());
        await trimCache(ASSET_CACHE, MAX_ASSET_ENTRIES);
      }
      return response;
    })
    .catch(() => undefined);
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  return (await refresh) || Response.error();
}

async function publicPageNetworkFirst(request, key, onMiss) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const response = await fetch(request);
    if (key && response.ok && !response.redirected) await cache.put(key, response.clone());
    return response;
  } catch {
    const cached = key ? await cache.match(key, { ignoreVary: true }) : undefined;
    return cached ?? onMiss();
  }
}

// Fallback genérico: el /offline de esta tienda si se conoce; si no, cualquiera guardado. No tiene datos de usuario.
async function offlineFallback(variant) {
  const cache = await caches.open(PAGE_CACHE);
  const own = await cache.match(pageKey(OFFLINE_URL, variant), { ignoreVary: true });
  if (own) return own;
  const generic = await cache.match(pageKey(OFFLINE_URL, null), { ignoreVary: true });
  if (generic) return generic;
  return new Response('<!doctype html><meta charset="utf-8"><title>Sin conexión</title><h1>Sin conexión</h1>', {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
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

  // La API puede ser cross-origin. Lo que no esté en la lista pasa directo, sin tocar Cache Storage.
  if (url.pathname.startsWith('/api/')) {
    if (PUBLIC_API.some((pattern) => pattern.test(url.pathname))) {
      event.respondWith(publicApiNetworkFirst(event, request));
    }
    return;
  }

  // Chunks de Next: el nombre lleva hash, nunca cambian
  if (url.origin === self.location.origin && url.pathname.startsWith('/_next/static/')) {
    event.respondWith(immutableCacheFirst(request));
    return;
  }

  // Scripts y estilos de terceros (chat, pagos) no se tocan: deben llegar siempre frescos de su origen
  if (request.destination === 'image' || request.destination === 'font') {
    event.respondWith(assetStaleWhileRevalidate(event, request));
    return;
  }
  if (url.origin !== self.location.origin) return;

  // manifest e íconos dependen de la tienda: siempre red, con la copia solo si no hay conexión y es la misma URL
  if (url.pathname === '/web-manifest') {
    event.respondWith(assetStaleWhileRevalidate(event, request));
    return;
  }

  // Datos RSC de la navegación del cliente. Mismo tratamiento que su HTML; nunca stale con red disponible.
  if (request.headers.has('rsc') || url.searchParams.has('_rsc')) {
    if (!PUBLIC_PAGE.test(url.pathname)) {
      event.respondWith(fetch(request).catch(controlledFailureResponse));
      return;
    }
    event.respondWith(
      (async () => {
        const variant = await pageVariant();
        return publicPageNetworkFirst(request, variant ? pageKey(url.pathname + url.search, variant) : null, controlledFailureResponse);
      })(),
    );
    return;
  }

  // Navegación (cargar una página completa)
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const variant = await pageVariant();
        const isPublic = PUBLIC_PAGE.test(url.pathname);
        const key = isPublic && variant ? pageKey(url.pathname + url.search, variant) : null;
        return publicPageNetworkFirst(request, key, () => offlineFallback(variant));
      })(),
    );
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
    icon: data.icon || '/pwa-icon/192',
    badge: data.icon || '/pwa-icon/192',
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
