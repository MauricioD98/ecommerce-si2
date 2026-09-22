import { CreateOrderRequest } from "@/types/orders.types";

export interface OfflineOrder {
    id: string;
    payload: CreateOrderRequest;
    createdAt: string;
    status: "pending" | "failed";
    lastError?: string;
}

const DB_NAME = "stella-femme-offline";
const DB_VERSION = 1;
const STORE_NAME = "orders";

const isSupported = () => typeof window !== "undefined" && "indexedDB" in window;

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
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

// Guarda un pedido armado offline (mismo shape que POST /orders) para reintentarlo al volver la conexión
export async function addOfflineOrder(payload: CreateOrderRequest): Promise<OfflineOrder> {
    if (!isSupported()) throw new Error("IndexedDB no disponible en este navegador");

    const order: OfflineOrder = {
        id: crypto.randomUUID(),
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
