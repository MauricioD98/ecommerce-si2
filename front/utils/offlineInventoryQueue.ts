import { InventoryItem, SetInventoryPayload } from "@/types/admin.types";
import { Product } from "@/types/product.types";

export interface OfflineInventoryUpdate {
    id: string;
    branchId: string;
    productId: string;
    productName?: string;
    payload: SetInventoryPayload;
    createdAt: string;
    status: "pending" | "failed";
    lastError?: string;
}

const DB_NAME = "stella-femme-offline";
const DB_VERSION = 2;
const STORE_NAME = "inventory_queue";
const INVENTORY_CACHE_PREFIX = "sf_cached_branch_inv_";
const PRODUCTS_CACHE_PREFIX = "sf_cached_branch_prod_";

const isSupported = () => typeof window !== "undefined" && "indexedDB" in window;

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            const db = request.result;
            if (!db.objectStoreNames.contains("orders")) {
                db.createObjectStore("orders", { keyPath: "id" });
            }
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "id" });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const request = fn(tx.objectStore(STORE_NAME));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
    });
}

// Agrega o reemplaza una actualización de stock para una sucursal y producto
export async function addOfflineInventoryUpdate(
    branchId: string,
    productId: string,
    payload: SetInventoryPayload,
    productName?: string
): Promise<OfflineInventoryUpdate> {
    if (!isSupported()) {
        throw new Error("IndexedDB no disponible en este navegador");
    }

    // Si ya existe una actualización pendiente para este mismo producto en esta sucursal, la actualizamos
    const existingList = await getOfflineInventoryUpdates();
    const existing = existingList.find((item) => item.branchId === branchId && item.productId === productId);

    const update: OfflineInventoryUpdate = {
        id: existing ? existing.id : (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `inv-offline-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`),
        branchId,
        productId,
        productName,
        payload,
        createdAt: new Date().toISOString(),
        status: "pending",
    };

    await withStore("readwrite", (store) => store.put(update));

    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("offline-inventory-added"));
    }

    return update;
}

export async function getOfflineInventoryUpdates(): Promise<OfflineInventoryUpdate[]> {
    if (!isSupported()) return [];
    try {
        return await withStore("readonly", (store) => store.getAll());
    } catch {
        return [];
    }
}

export async function removeOfflineInventoryUpdate(id: string): Promise<void> {
    if (!isSupported()) return;
    try {
        await withStore("readwrite", (store) => store.delete(id));
    } catch {}
}

export async function updateOfflineInventoryUpdate(
    id: string,
    patch: Partial<Pick<OfflineInventoryUpdate, "status" | "lastError">>
): Promise<void> {
    if (!isSupported()) return;
    try {
        const existing = await withStore<OfflineInventoryUpdate | undefined>("readonly", (store) => store.get(id));
        if (!existing) return;
        await withStore("readwrite", (store) => store.put({ ...existing, ...patch }));
    } catch {}
}

// ─── CACHÉ LOCAL DE INVENTARIO Y PRODUCTOS PARA EL ADMIN ───────────────────────

export function cacheBranchInventory(branchId: string, items: InventoryItem[]): void {
    if (typeof window === "undefined" || !branchId || !items) return;
    try {
        localStorage.setItem(`${INVENTORY_CACHE_PREFIX}${branchId}`, JSON.stringify(items));
    } catch {}
}

export function getCachedBranchInventory(branchId: string): InventoryItem[] | null {
    if (typeof window === "undefined" || !branchId) return null;
    try {
        const raw = localStorage.getItem(`${INVENTORY_CACHE_PREFIX}${branchId}`);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

export function cacheBranchProducts(branchId: string, products: Product[]): void {
    if (typeof window === "undefined" || !branchId || !products) return;
    try {
        localStorage.setItem(`${PRODUCTS_CACHE_PREFIX}${branchId}`, JSON.stringify(products));
    } catch {}
}

export function getCachedBranchProducts(branchId: string): Product[] | null {
    if (typeof window === "undefined" || !branchId) return null;
    try {
        const raw = localStorage.getItem(`${PRODUCTS_CACHE_PREFIX}${branchId}`);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}
