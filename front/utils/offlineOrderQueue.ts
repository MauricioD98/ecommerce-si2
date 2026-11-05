import { CreateOrderRequest } from "@/types/orders.types";
import { DRAFTS_STORE, isOfflineDbSupported, withOfflineStore } from "./offlineDb";
import { getCurrentTenantId } from "./tenant";

// Dos conceptos que NO se mezclan:
//  - OrderDraft (acá): armado sin conexión. No tiene stock garantizado ni pago, y NUNCA se envía solo: al
//    volver la conexión se revalida en el checkout y se pide confirmación antes de crear una compra nueva.
//  - CheckoutAttempt (checkoutAttempts.ts): ya autorizado y posiblemente enviado. Ese sí se recupera solo.
export interface OrderDraft {
    id: string;
    payload: Omit<CreateOrderRequest, "cartVersion" | "expectedTotal">;
    createdAt: string;
    // null solo en colas antiguas, que se guardaron sin propietario
    userId: string | null;
    legacyUnowned?: boolean;
}

const isSupported = () => isOfflineDbSupported() && getCurrentTenantId() !== null;

export async function addOrderDraft(userId: string, payload: OrderDraft["payload"]): Promise<OrderDraft> {
    if (!isOfflineDbSupported()) throw new Error("IndexedDB no disponible en este navegador");
    if (!getCurrentTenantId()) throw new Error("No hay una tienda seleccionada para guardar el borrador");

    const draft: OrderDraft = { id: crypto.randomUUID(), payload, createdAt: new Date().toISOString(), userId };
    await withOfflineStore(DRAFTS_STORE, "readwrite", (store) => store.add(draft));
    return draft;
}

// Solo los de este usuario, más los antiguos sin propietario (que exigen revisión explícita)
export async function getOrderDrafts(userId: string | null): Promise<OrderDraft[]> {
    if (!isSupported() || !userId) return [];
    const drafts = await withOfflineStore<OrderDraft[]>(DRAFTS_STORE, "readonly", (store) => store.getAll());
    return drafts.filter((draft) => draft.userId === userId || draft.userId === null);
}

export async function removeOrderDraft(id: string): Promise<void> {
    if (!isSupported()) return;
    await withOfflineStore(DRAFTS_STORE, "readwrite", (store) => store.delete(id));
}
