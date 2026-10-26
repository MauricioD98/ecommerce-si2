import { InventoryItem, SetInventoryPayload } from "@/types/admin.types";
import { Product } from "@/types/product.types";
import { INVENTORY_STORE, isOfflineDbSupported, withOfflineStore } from "./offlineDb";
import { getCurrentTenantId, tenantScopedKey } from "./tenant";

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

// Las cachés de localStorage también van por tienda: los branchId son UUID por schema, pero sin
// prefijo un admin que cambia de tienda vería el inventario cacheado de la anterior al estar offline.
const inventoryCacheKey = (branchId: string) => tenantScopedKey(`sf_cached_branch_inv_${branchId}`);
const productsCacheKey = (branchId: string) => tenantScopedKey(`sf_cached_branch_prod_${branchId}`);

// La base es por tienda (ver offlineDb.ts): solo se ven y sincronizan los ajustes de la tienda activa
const isSupported = () => isOfflineDbSupported() && getCurrentTenantId() !== null;

const withStore = <T,>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>) =>
    withOfflineStore(INVENTORY_STORE, mode, fn);

// Agrega o reemplaza una actualización de stock para una sucursal y producto
export async function addOfflineInventoryUpdate(
    branchId: string,
    productId: string,
    payload: SetInventoryPayload,
    productName?: string
): Promise<OfflineInventoryUpdate> {
    if (!isOfflineDbSupported()) {
        throw new Error("IndexedDB no disponible en este navegador");
    }
    if (!getCurrentTenantId()) {
        throw new Error("No hay una tienda seleccionada para guardar el ajuste offline");
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
        localStorage.setItem(inventoryCacheKey(branchId), JSON.stringify(items));
    } catch {}
}

export function getCachedBranchInventory(branchId: string): InventoryItem[] | null {
    if (typeof window === "undefined" || !branchId) return null;
    try {
        const raw = localStorage.getItem(inventoryCacheKey(branchId));
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

export function cacheBranchProducts(branchId: string, products: Product[]): void {
    if (typeof window === "undefined" || !branchId || !products) return;
    try {
        localStorage.setItem(productsCacheKey(branchId), JSON.stringify(products));
    } catch {}
}

export function getCachedBranchProducts(branchId: string): Product[] | null {
    if (typeof window === "undefined" || !branchId) return null;
    try {
        const raw = localStorage.getItem(productsCacheKey(branchId));
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}
