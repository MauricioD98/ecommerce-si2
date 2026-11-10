// Directorio de tiendas para el selector del login (GET /platform/tenants/public, el mismo que usa el
// selector de la web). JS plano (CommonJS) sin React Native, como src/offline/offlineCore.js, para
// probarlo con Node: npm run test:stores.
//
// Solo datos públicos de la tienda (id, nombre, slug, plan, logo). Elegir una tienda solo fija el
// x-tenant-id: el inicio de sesión se hace SOLO en esa tienda y el backend comprueba que la cuenta
// le pertenece (el mismo correo puede existir en otras tiendas).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Sin tildes, minúsculas, espacios simples: "Estéla  FEMME" encuentra "Estela Femme"
function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .trim();
}

/** URL usable por <Image>: https absoluta tal cual; ruta de la API (/platform/...) → base de la API. */
function resolveLogoUrl(logoUrl, apiBaseUrl) {
  if (typeof logoUrl !== 'string' || !logoUrl.trim()) return null;
  const value = logoUrl.trim();
  if (/^https:\/\//i.test(value)) return value;
  if (value.startsWith('/') && typeof apiBaseUrl === 'string' && apiBaseUrl) {
    return apiBaseUrl.replace(/\/+$/, '') + value;
  }
  return null;
}

/** Valida y deja solo lo necesario de cada tienda de la respuesta del directorio. */
function toStores(rawList, apiBaseUrl) {
  if (!Array.isArray(rawList)) return [];
  const seen = new Set();
  const stores = [];
  for (const raw of rawList) {
    if (!raw || typeof raw !== 'object') continue;
    const id = typeof raw.id === 'string' ? raw.id.trim().toLowerCase() : '';
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!UUID_RE.test(id) || !name || seen.has(id)) continue;
    seen.add(id);
    stores.push({
      id,
      name,
      slug: typeof raw.slug === 'string' ? raw.slug : '',
      planName: typeof raw.planName === 'string' ? raw.planName : null,
      // El directorio lo informa por plan; la API vuelve a exigirlo al iniciar sesión en el móvil
      mobileApp: raw.mobileApp !== false,
      logoUrl: resolveLogoUrl(raw.logoUrl, apiBaseUrl),
    });
  }
  return stores;
}

/**
 * Busca por el nombre visible (y el identificador, por si el cliente lo conoce). Las coincidencias al
 * inicio del nombre van primero; las tiendas sin app móvil quedan al final.
 */
function searchStores(stores, query) {
  const q = normalizeText(query);
  const scored = [];
  for (const store of stores || []) {
    const name = normalizeText(store.name);
    const slug = normalizeText(store.slug);
    let score;
    if (!q) score = 2;
    else if (name.startsWith(q)) score = 0;
    else if (name.split(' ').some((word) => word.startsWith(q))) score = 1;
    else if (name.includes(q) || slug.includes(q)) score = 2;
    else continue;
    scored.push({ store, score: score + (store.mobileApp ? 0 : 10) });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.store.name.localeCompare(b.store.name, undefined, { sensitivity: 'base' }))
    .map((entry) => entry.store);
}

/** Iniciales para cuando la tienda no tiene logo (o no carga): "Stella Femme Demo" → "SF". */
function storeInitials(name) {
  const words = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const letters = words.slice(0, 2).map((w) => w[0]);
  return (letters.join('') || '?').toUpperCase();
}

/** Por qué falló la carga del directorio: sin conexión o error del servidor. */
function classifyDirectoryError({ online, status } = {}) {
  if (online === false) return 'offline';
  if (typeof status !== 'number') return 'network';
  return 'server';
}

module.exports = { normalizeText, resolveLogoUrl, toStores, searchStores, storeInitials, classifyDirectoryError };
