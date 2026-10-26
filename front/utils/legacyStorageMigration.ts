import { INVENTORY_STORE, ORDERS_STORE, isOfflineDbSupported, offlineDbName, withOfflineStore } from "./offlineDb";
import { LEGACY_TENANT_ID, getCurrentTenantId, tenantScopedKey } from "./tenant";

// Antes del multitenant todo se guardaba con claves sin tienda. Esos datos son de la tienda original
// (LEGACY_TENANT_ID): si este navegador opera esa tienda, se mueven a las claves nuevas para no
// perder el carrito, la sesión ni pedidos/ajustes offline que quedaron pendientes al desplegar.
// En cualquier otra tienda NO se migran (serían datos ajenos) y quedan intactos hasta que el
// navegador abra la tienda original.

const LEGACY_DB_NAME = "stella-femme-offline";
const LEGACY_DB_VERSION = 2;
const MIGRATED_FLAG = "sf_legacy_storage_migrated";

const LEGACY_LOCAL_KEYS = ["persist:root", "sf_cached_products"];
const LEGACY_LOCAL_PREFIXES = ["sf_cached_branch_inv_", "sf_cached_branch_prod_"];

const shouldMigrate = () =>
    typeof window !== "undefined" && LEGACY_TENANT_ID !== null && getCurrentTenantId() === LEGACY_TENANT_ID;

// Clave nueva equivalente. persist:root → persist:root:<tenant> (redux-persist antepone "persist:")
const scopedKeyFor = (legacyKey: string) =>
    legacyKey.startsWith("persist:")
        ? `persist:${tenantScopedKey(legacyKey.slice("persist:".length))}`
        : tenantScopedKey(legacyKey);

/**
 * Síncrona a propósito: store/index.tsx la llama ANTES de crear el persistReducer, para que
 * redux-persist rehidrate desde la clave nueva ya poblada en el primer render.
 */
export function migrateLegacyLocalStorage(): void {
    if (!shouldMigrate()) return;
    try {
        if (localStorage.getItem(MIGRATED_FLAG)) return;

        const keys = Object.keys(localStorage).filter(
            (key) => LEGACY_LOCAL_KEYS.includes(key) || LEGACY_LOCAL_PREFIXES.some((prefix) => key.startsWith(prefix))
        );
        for (const key of keys) {
            const value = localStorage.getItem(key);
            const target = scopedKeyFor(key);
            // Si la clave nueva ya tiene datos (se usó la app después del deploy), ganan los nuevos
            if (value !== null && localStorage.getItem(target) === null) localStorage.setItem(target, value);
            localStorage.removeItem(key);
        }
        localStorage.setItem(MIGRATED_FLAG, new Date().toISOString());
    } catch {
        // Storage lleno o bloqueado: se reintenta en la próxima carga
    }
}

// Abre la base vieja SIN crearla: si no existía, onupgradeneeded (oldVersion 0) aborta la apertura
function openLegacyDbIfExists(): Promise<IDBDatabase | null> {
    return new Promise((resolve) => {
        const request = indexedDB.open(LEGACY_DB_NAME, LEGACY_DB_VERSION);
        request.onupgradeneeded = (event) => {
            if (event.oldVersion === 0) request.transaction?.abort();
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
    });
}

function readAll<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
    if (!db.objectStoreNames.contains(storeName)) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
        const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result as T[]);
        request.onerror = () => reject(request.error);
    });
}

/** Mueve la cola offline vieja (pedidos + inventario) a la base de la tienda original y la borra. */
export async function migrateLegacyOfflineDb(): Promise<void> {
    if (!shouldMigrate() || !isOfflineDbSupported()) return;
    // Nunca migrar sobre sí misma (offlineDbName de la tienda legacy ≠ nombre viejo, pero por las dudas)
    if (offlineDbName(LEGACY_TENANT_ID!) === LEGACY_DB_NAME) return;

    const legacy = await openLegacyDbIfExists();
    if (!legacy) return;

    try {
        const [orders, inventory] = await Promise.all([
            readAll<{ id: string }>(legacy, ORDERS_STORE),
            readAll<{ id: string }>(legacy, INVENTORY_STORE),
        ]);
        // put (no add): idempotente si una migración anterior se cortó a la mitad
        for (const order of orders) await withOfflineStore(ORDERS_STORE, "readwrite", (store) => store.put(order));
        for (const update of inventory) await withOfflineStore(INVENTORY_STORE, "readwrite", (store) => store.put(update));
        legacy.close();
        indexedDB.deleteDatabase(LEGACY_DB_NAME);

        // Los hooks de sincronización (useOfflineOrderSync / useOfflineInventorySync) recalculan sus contadores
        if (orders.length > 0) window.dispatchEvent(new CustomEvent("offline-order-added"));
        if (inventory.length > 0) window.dispatchEvent(new CustomEvent("offline-inventory-added"));
    } catch {
        legacy.close();
        // Sin borrar la base vieja: se reintenta en la próxima carga
    }
}
