import axios from "axios";
import { store } from "@/store";
import type { Order } from "@/types/orders.types";
import { ORDERS_CACHE_STORE, isOfflineDbSupported, upsertInOfflineStore, withOfflineStore } from "./offlineDb";
import { getCurrentTenantId } from "./tenant";

// "Mis pedidos" sin conexión: copia de SOLO LECTURA de lo que el cliente ya vio con conexión (páginas de la
// lista y detalles abiertos). Vive en IndexedDB de la tienda activa, un registro por usuario, y se borra al
// cerrar sesión. Nunca pasa por Cache Storage del service worker. Sin red no se puede pagar, cancelar ni
// enviar comprobantes: eso lo decide el servidor.

interface OrdersCache {
    userId: string;
    tenantId: string;
    pages: Record<number, { data: Order[]; total: number; limit: number }>;
    details: Record<string, Order>;
    savedAt: string;
}

// Topes: es una copia de consulta, no un archivo histórico
const MAX_PAGES = 5;
const MAX_DETAILS = 30;

const isSupported = () => isOfflineDbSupported() && getCurrentTenantId() !== null;
const currentUserId = () => store.getState().auth.user?.id ?? null;

/** Error sin respuesta del servidor (sin red, servidor caído): el único caso en que se usa la copia */
export const isNetworkFailure = (error: unknown) => axios.isAxiosError(error) && !error.response;

async function update(userId: string, fn: (cache: OrdersCache) => OrdersCache): Promise<void> {
    const tenantId = getCurrentTenantId();
    if (!isSupported() || !tenantId) return;
    try {
        await upsertInOfflineStore<OrdersCache>(ORDERS_CACHE_STORE, userId, (current) =>
            fn(
                current && current.tenantId === tenantId
                    ? current
                    : { userId, tenantId, pages: {}, details: {}, savedAt: new Date().toISOString() },
            ),
        );
    } catch {}
}

async function read(userId: string): Promise<OrdersCache | null> {
    if (!isSupported() || !userId) return null;
    try {
        const cache = await withOfflineStore<OrdersCache | undefined>(ORDERS_CACHE_STORE, "readonly", (s) => s.get(userId));
        return cache && cache.userId === userId && cache.tenantId === getCurrentTenantId() ? cache : null;
    } catch {
        return null;
    }
}

export async function cacheOrdersPage(page: number, limit: number, data: Order[], total: number): Promise<void> {
    const userId = currentUserId();
    if (!userId) return;
    await update(userId, (cache) => {
        const pages = { ...cache.pages, [page]: { data, total, limit } };
        for (const key of Object.keys(pages).map(Number).sort((a, b) => a - b).slice(MAX_PAGES)) delete pages[key];
        return { ...cache, pages, savedAt: new Date().toISOString() };
    });
    await dropOtherOrderCaches(userId);
}

export async function cacheOrderDetail(order: Order): Promise<void> {
    const userId = currentUserId();
    if (!userId || !order?.id) return;
    await update(userId, (cache) => {
        const details = { ...cache.details, [order.id]: order };
        const ids = Object.keys(details);
        for (const id of ids.slice(0, Math.max(0, ids.length - MAX_DETAILS))) delete details[id];
        return { ...cache, details, savedAt: new Date().toISOString() };
    });
}

export async function getCachedOrdersPage(page: number): Promise<{ data: Order[]; total: number; savedAt: string } | null> {
    const userId = currentUserId();
    const cache = userId ? await read(userId) : null;
    const entry = cache?.pages[page];
    return entry && cache ? { data: entry.data, total: entry.total, savedAt: cache.savedAt } : null;
}

export async function getCachedOrder(orderId: string): Promise<{ order: Order; savedAt: string } | null> {
    const userId = currentUserId();
    const cache = userId ? await read(userId) : null;
    if (!cache) return null;
    // El detalle abierto antes; si no, el resumen que venía en la lista
    const order = cache.details[orderId] ?? Object.values(cache.pages).flatMap((p) => p.data).find((o) => o.id === orderId);
    return order ? { order, savedAt: cache.savedAt } : null;
}

export async function hasCachedOrders(userId: string): Promise<boolean> {
    const cache = await read(userId);
    return !!cache && (Object.keys(cache.pages).length > 0 || Object.keys(cache.details).length > 0);
}

/** Al cerrar sesión: la próxima persona en el dispositivo no ve los pedidos de esta cuenta */
export async function clearOrdersCache(): Promise<void> {
    if (!isSupported()) return;
    try {
        await withOfflineStore(ORDERS_CACHE_STORE, "readwrite", (s) => s.clear());
    } catch {}
}

async function dropOtherOrderCaches(userId: string): Promise<void> {
    try {
        const keys = await withOfflineStore<IDBValidKey[]>(ORDERS_CACHE_STORE, "readonly", (s) => s.getAllKeys());
        for (const key of keys) {
            if (key !== userId) await withOfflineStore(ORDERS_CACHE_STORE, "readwrite", (s) => s.delete(key));
        }
    } catch {}
}
