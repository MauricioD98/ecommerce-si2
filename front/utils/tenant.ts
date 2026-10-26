// Tienda (tenant) activa en este navegador. El backend la exige en cada petición como header
// x-tenant-id (UUID) y rechaza con 401 si falta o no coincide con la del JWT.
//
// Orden de resolución (la primera que aparezca gana):
//   0. cookie sf_tenant                → dominio propio de la tienda, la resuelve front/proxy.ts
//   1. ?tenant=<uuid> en la URL       → links de onboarding / QR del POS; se recuerda en localStorage
//   2. la última recordada en localStorage
//   3. NEXT_PUBLIC_TENANT_ID           → despliegues de una sola tienda y SSR
//
// Se resuelve una sola vez por carga de página y queda fija: redux-persist y las bases IndexedDB
// arman su nombre con ella al iniciar. Para cambiar de tienda usar switchTenant(), que recarga.

export const TENANT_HEADER = "x-tenant-id";
// Código que manda el backend (TenantMiddleware) cuando falta la tienda o no es válida
export const TENANT_REQUIRED = "TENANT_REQUIRED";
const TENANT_REQUIRED_EVENT = "tenant-required";

// La tienda original (schema tenant_legacy): sus datos locales de antes del multitenant se migran a
// las claves nuevas solo si este navegador opera esa tienda (ver utils/legacyStorageMigration.ts)
export const LEGACY_TENANT_ID = (process.env.NEXT_PUBLIC_LEGACY_TENANT_ID ?? "").trim().toLowerCase() || null;

// Pide al <TenantGate/> que muestre el selector de tienda. Lo dispara el interceptor de Axios.
export function requestTenantSelection(): void {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(TENANT_REQUIRED_EVENT));
}

export function onTenantSelectionRequested(handler: () => void): () => void {
    window.addEventListener(TENANT_REQUIRED_EVENT, handler);
    return () => window.removeEventListener(TENANT_REQUIRED_EVENT, handler);
}

const STORAGE_KEY = "sf_tenant_id";
// La pone front/proxy.ts en los dominios propios de cada tienda
const DOMAIN_COOKIE = "sf_tenant";

const readCookie = (name: string): string | null => {
    const match = document.cookie.split("; ").find((part) => part.startsWith(`${name}=`));
    return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
};
const QUERY_PARAM = "tenant";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let resolved: string | null | undefined;

const normalize = (value: string | null | undefined): string | null => {
    const v = value?.trim().toLowerCase();
    return v && UUID_RE.test(v) ? v : null;
};

const envTenant = () => normalize(process.env.NEXT_PUBLIC_TENANT_ID);

export function getCurrentTenantId(): string | null {
    // En el servidor no hay URL del usuario ni localStorage, y el valor no se cachea entre requests
    if (typeof window === "undefined") return envTenant();
    if (resolved !== undefined) return resolved;

    // Dominio propio: front/proxy.ts resolvió la tienda desde el Host y la dejó en esta cookie. Gana
    // sobre todo lo demás: en boutiquemia.com la tienda es la del dominio, venga el link que venga.
    const fromDomain = normalize(readCookie(DOMAIN_COOKIE));
    if (fromDomain) {
        resolved = fromDomain;
        return resolved;
    }

    const fromUrl = normalize(new URLSearchParams(window.location.search).get(QUERY_PARAM));
    let fromStorage: string | null = null;
    try {
        fromStorage = normalize(localStorage.getItem(STORAGE_KEY));
        if (fromUrl && fromUrl !== fromStorage) localStorage.setItem(STORAGE_KEY, fromUrl);
    } catch {}

    resolved = fromUrl ?? fromStorage ?? envTenant();
    return resolved;
}

export function requireTenantId(): string {
    const id = getCurrentTenantId();
    if (!id) throw new Error("No hay una tienda seleccionada en este dispositivo");
    return id;
}

// Cambia de tienda y recarga: todo lo que se inicializó con la anterior (store persistido, auth,
// conexiones IndexedDB) se vuelve a armar con la nueva. Los datos de la otra tienda NO se borran:
// quedan en su propia base/clave y reaparecen si se vuelve a ella (p. ej. pedidos offline pendientes).
export async function switchTenant(tenantId: string): Promise<void> {
    const next = normalize(tenantId);
    if (!next) throw new Error(`ID de tienda inválido: ${tenantId}`);
    if (typeof window === "undefined") return;
    // Misma tienda: igual se recarga. Si el backend respondió TENANT_REQUIRED con esta tienda
    // guardada (estaba suspendida y se reactivó), recargar es lo que reintenta todo.

    try {
        localStorage.setItem(STORAGE_KEY, next);
    } catch {}

    // El service worker cachea GET /api/v1/* por URL, sin mirar headers: la misma URL de otra
    // tienda devolvería la respuesta cacheada de esta. Se vacía antes de cambiar.
    navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_API_CACHE" });

    const url = new URL(window.location.href);
    url.searchParams.delete(QUERY_PARAM);
    window.location.replace(url.toString());
}

// Prefija claves de almacenamiento local para que dos tiendas en el mismo dispositivo no las compartan
export function tenantScopedKey(base: string): string {
    return `${base}:${getCurrentTenantId() ?? "no-tenant"}`;
}
