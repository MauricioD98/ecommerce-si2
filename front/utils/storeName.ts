// Nombre de la tienda: lo que el cliente ve como "marca" (header, panel, recibos, títulos). La marca de
// la plataforma ("Stella Femme") queda solo para las páginas del SaaS (/planes, /plataforma).
// Archivo sin imports de Next: lo usan tanto el provider del cliente como utils/storeName.server.ts.

export const PLATFORM_BRAND = "Stella Femme";

// La escribe StoreInfoProvider: es la tienda que el navegador eligió (?tenant=, localStorage), que el
// servidor no puede ver. Solo sirve para mostrar el nombre en títulos y manifest: no autoriza nada
// (la tienda real de cada petición a la API la decide el backend con x-tenant-id).
export const STORE_HINT_COOKIE = "sf_store_tenant";

export const storeNameCacheKey = (tenantId: string) => `sf_store_name:${tenantId}`;
