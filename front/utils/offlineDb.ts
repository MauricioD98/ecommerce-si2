import { requireTenantId } from "./tenant";

// Base IndexedDB compartida por los datos offline. Una por tienda: "stella-femme-offline:<tenantId>".
// Así un dispositivo compartido (caja, tablet de depósito) que opera para dos tiendas nunca sincroniza
// el pedido o el ajuste de stock de una en la otra.

const DB_PREFIX = "stella-femme-offline";
const DB_VERSION = 6;

// Solo existe en bases anteriores a la v3: su contenido se migra a DRAFTS_STORE (ver upgrade)
export const LEGACY_ORDERS_STORE = "orders";
export const DRAFTS_STORE = "order_drafts";
export const ATTEMPTS_STORE = "checkout_attempts";
export const INVENTORY_STORE = "inventory_queue";
// v4: perfil sin conexión. Copia del último perfil leído del servidor y el cambio pendiente, uno por usuario
export const PROFILE_SNAPSHOT_STORE = "profile_snapshots";
export const PROFILE_CHANGES_STORE = "profile_changes";
// v5: copia de solo lectura de "Mis pedidos" (lista y detalles ya vistos), una por usuario
export const ORDERS_CACHE_STORE = "orders_cache";
// v6: panel de administración sin conexión. Copia de lo leído (por usuario) y cola de cambios a sincronizar
export const ADMIN_READ_STORE = "admin_read_cache";
export const ADMIN_CHANGES_STORE = "admin_changes";

export const isOfflineDbSupported = () => typeof window !== "undefined" && "indexedDB" in window;

export const offlineDbName = (tenantId: string) => `${DB_PREFIX}:${tenantId}`;

// `quota` permite a la UI distinguir "almacenamiento lleno" de cualquier otra falla
export class OfflineStorageError extends Error {
    constructor(
        message: string,
        readonly quota = false,
    ) {
        super(message);
        this.name = "OfflineStorageError";
    }
}

function toStorageError(error: unknown): OfflineStorageError {
    const name = (error as { name?: string } | null)?.name;
    const message = (error as { message?: string } | null)?.message ?? "No se pudo acceder al almacenamiento local";
    return new OfflineStorageError(message, name === "QuotaExceededError");
}

// Las colas antiguas se generaron sin propietario y sin clave enviada al servidor: se conservan como
// borradores que requieren revisión. No se puede saber de quién son ni si ya se procesaron.
export function legacyOrderToDraft(order: { id: string; payload: unknown; createdAt?: string }) {
    return {
        id: order.id,
        payload: order.payload,
        createdAt: order.createdAt ?? new Date().toISOString(),
        userId: null,
        legacyUnowned: true,
    };
}

function openDb(): Promise<IDBDatabase> {
    // Sin tienda no se abre nada: escribir en una base "sin dueño" mezclaría datos al elegir una
    const name = offlineDbName(requireTenantId());
    return new Promise((resolve, reject) => {
        let request: IDBOpenDBRequest;
        try {
            request = indexedDB.open(name, DB_VERSION);
        } catch (error) {
            reject(toStorageError(error));
            return;
        }
        request.onupgradeneeded = () => {
            const db = request.result;
            const tx = request.transaction!;
            if (!db.objectStoreNames.contains(INVENTORY_STORE)) {
                db.createObjectStore(INVENTORY_STORE, { keyPath: "id" });
            }
            if (!db.objectStoreNames.contains(ATTEMPTS_STORE)) {
                db.createObjectStore(ATTEMPTS_STORE, { keyPath: "attemptId" });
            }
            if (!db.objectStoreNames.contains(PROFILE_SNAPSHOT_STORE)) {
                db.createObjectStore(PROFILE_SNAPSHOT_STORE, { keyPath: "userId" });
            }
            if (!db.objectStoreNames.contains(PROFILE_CHANGES_STORE)) {
                db.createObjectStore(PROFILE_CHANGES_STORE, { keyPath: "userId" });
            }
            if (!db.objectStoreNames.contains(ORDERS_CACHE_STORE)) {
                db.createObjectStore(ORDERS_CACHE_STORE, { keyPath: "userId" });
            }
            if (!db.objectStoreNames.contains(ADMIN_READ_STORE)) {
                db.createObjectStore(ADMIN_READ_STORE, { keyPath: "key" });
            }
            if (!db.objectStoreNames.contains(ADMIN_CHANGES_STORE)) {
                db.createObjectStore(ADMIN_CHANGES_STORE, { keyPath: "changeId" });
            }
            const drafts = db.objectStoreNames.contains(DRAFTS_STORE)
                ? tx.objectStore(DRAFTS_STORE)
                : db.createObjectStore(DRAFTS_STORE, { keyPath: "id" });

            if (db.objectStoreNames.contains(LEGACY_ORDERS_STORE)) {
                const cursor = tx.objectStore(LEGACY_ORDERS_STORE).openCursor();
                cursor.onsuccess = () => {
                    const current = cursor.result;
                    if (current) {
                        drafts.put(legacyOrderToDraft(current.value));
                        current.continue();
                    } else {
                        // Misma transacción de versión: o se migra todo y se borra, o no pasa nada
                        db.deleteObjectStore(LEGACY_ORDERS_STORE);
                    }
                };
            }
        };
        // Otra pestaña con la versión vieja impide actualizar: mejor un error que una espera infinita
        request.onblocked = () => reject(new OfflineStorageError("Otra pestaña bloquea la actualización del almacenamiento local"));
        request.onsuccess = () => {
            const db = request.result;
            // Si otra pestaña necesita una versión nueva, esta cede para no bloquearla
            db.onversionchange = () => db.close();
            resolve(db);
        };
        request.onerror = () => reject(toStorageError(request.error));
    });
}

// Resuelve SOLO tras oncomplete: hasta entonces el navegador puede abortar y perder la escritura, y un
// intento de compra se reporta como guardado únicamente si de verdad lo está.
export async function withOfflineStore<T>(
    storeName: string,
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
    const db = await openDb();
    return new Promise<T>((resolve, reject) => {
        const finish = () => db.close();
        try {
            const tx = db.transaction(storeName, mode);
            const request = fn(tx.objectStore(storeName));
            tx.oncomplete = () => {
                finish();
                resolve(request.result);
            };
            tx.onabort = () => {
                finish();
                reject(toStorageError(tx.error ?? request.error));
            };
            tx.onerror = () => {
                // Le sigue onabort salvo que se haya prevenido: aquí no hay nada que resolver todavía
            };
        } catch (error) {
            finish();
            reject(toStorageError(error));
        }
    });
}

// Leer y escribir en la MISMA transacción: dos pestañas no se pisan el registro
export async function patchInOfflineStore<T>(storeName: string, key: IDBValidKey, patch: (current: T) => T): Promise<T | undefined> {
    const db = await openDb();
    return new Promise<T | undefined>((resolve, reject) => {
        try {
            const tx = db.transaction(storeName, "readwrite");
            const store = tx.objectStore(storeName);
            const read = store.get(key);
            let saved: T | undefined;
            read.onsuccess = () => {
                if (read.result === undefined) return;
                saved = patch(read.result as T);
                store.put(saved);
            };
            tx.oncomplete = () => {
                db.close();
                resolve(saved);
            };
            tx.onabort = () => {
                db.close();
                reject(toStorageError(tx.error));
            };
        } catch (error) {
            db.close();
            reject(toStorageError(error));
        }
    });
}

// Como patchInOfflineStore, pero también crea (sin registro previo) o borra (si `update` devuelve null).
// undefined = no tocar nada. Lectura y escritura en la misma transacción: dos pestañas no se pisan.
export async function upsertInOfflineStore<T>(
    storeName: string,
    key: IDBValidKey,
    update: (current: T | undefined) => T | null | undefined,
): Promise<T | null | undefined> {
    const db = await openDb();
    return new Promise<T | null | undefined>((resolve, reject) => {
        try {
            const tx = db.transaction(storeName, "readwrite");
            const store = tx.objectStore(storeName);
            const read = store.get(key);
            let result: T | null | undefined;
            read.onsuccess = () => {
                result = update(read.result as T | undefined);
                if (result === null) store.delete(key);
                else if (result !== undefined) store.put(result);
            };
            tx.oncomplete = () => {
                db.close();
                resolve(result);
            };
            tx.onabort = () => {
                db.close();
                reject(toStorageError(tx.error));
            };
        } catch (error) {
            db.close();
            reject(toStorageError(error));
        }
    });
}
