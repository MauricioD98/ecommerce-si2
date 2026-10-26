import { requireTenantId } from "./tenant";

// Base IndexedDB compartida por las colas offline (pedidos e inventario). Una por tienda:
// "stella-femme-offline:<tenantId>". Así un dispositivo compartido (caja, tablet de depósito) que
// opera para dos tiendas nunca sincroniza el pedido o el ajuste de stock de una en la otra.
//
// Antes cada cola tenía su propio openDb() con el mismo nombre/versión/upgrade duplicado; si una
// subía DB_VERSION sin la otra, la segunda fallaba con VersionError. Ahora hay un solo lugar.

const DB_PREFIX = "stella-femme-offline";
const DB_VERSION = 2;

export const ORDERS_STORE = "orders";
export const INVENTORY_STORE = "inventory_queue";

export const isOfflineDbSupported = () => typeof window !== "undefined" && "indexedDB" in window;

export const offlineDbName = (tenantId: string) => `${DB_PREFIX}:${tenantId}`;

function openDb(): Promise<IDBDatabase> {
    // Sin tienda no se abre nada: escribir en una base "sin dueño" mezclaría datos al elegir una
    const name = offlineDbName(requireTenantId());
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(name, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(ORDERS_STORE)) {
                db.createObjectStore(ORDERS_STORE, { keyPath: "id" });
            }
            if (!db.objectStoreNames.contains(INVENTORY_STORE)) {
                db.createObjectStore(INVENTORY_STORE, { keyPath: "id" });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function withOfflineStore<T>(
    storeName: string,
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const request = fn(tx.objectStore(storeName));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
    });
}
