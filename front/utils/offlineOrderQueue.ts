import { CreateOrderRequest } from "@/types/orders.types";
import { ORDERS_STORE, isOfflineDbSupported, withOfflineStore } from "./offlineDb";
import { getCurrentTenantId } from "./tenant";

export interface OfflineOrder {
    id: string;
    payload: CreateOrderRequest;
    createdAt: string;
    status: "pending" | "failed";
    lastError?: string;
}

// La base es por tienda (ver offlineDb.ts): solo se ven y sincronizan los pedidos de la tienda activa
const isSupported = () => isOfflineDbSupported() && getCurrentTenantId() !== null;

const withStore = <T,>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>) =>
    withOfflineStore(ORDERS_STORE, mode, fn);

// Guarda un pedido armado offline (mismo shape que POST /orders) para reintentarlo al volver la conexión
export async function addOfflineOrder(payload: CreateOrderRequest): Promise<OfflineOrder> {
    if (!isOfflineDbSupported()) throw new Error("IndexedDB no disponible en este navegador");
    if (!getCurrentTenantId()) throw new Error("No hay una tienda seleccionada para guardar el pedido offline");

    const order: OfflineOrder = {
        id:
            typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
                ? crypto.randomUUID()
                : `offline-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        payload,
        createdAt: new Date().toISOString(),
        status: "pending",
    };
    await withStore("readwrite", (store) => store.add(order));
    return order;
}

export async function getOfflineOrders(): Promise<OfflineOrder[]> {
    if (!isSupported()) return [];
    return withStore("readonly", (store) => store.getAll());
}

export async function removeOfflineOrder(id: string): Promise<void> {
    if (!isSupported()) return;
    await withStore("readwrite", (store) => store.delete(id));
}

export async function updateOfflineOrder(id: string, patch: Partial<Pick<OfflineOrder, "status" | "lastError">>): Promise<void> {
    if (!isSupported()) return;
    const existing = await withStore<OfflineOrder | undefined>("readonly", (store) => store.get(id));
    if (!existing) return;
    await withStore("readwrite", (store) => store.put({ ...existing, ...patch }));
}
