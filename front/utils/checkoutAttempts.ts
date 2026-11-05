import axios from "axios";
import { OrderService } from "@/service/api/order.service";
import { CreateOrderRequest } from "@/types/orders.types";
import { ATTEMPTS_STORE, isOfflineDbSupported, patchInOfflineStore, withOfflineStore } from "./offlineDb";
import { getCurrentTenantId } from "./tenant";

// Intento de compra ya autorizado por el usuario. La clave nace UNA vez, antes del primer envío, y se
// reutiliza en cada reintento. Un timeout, una desconexión o un 5xx no prueban que falló: el servidor pudo
// confirmar y perder la respuesta. Solo guarda el snapshot del pedido: nunca tarjetas, tokens ni client_secret.
export type AttemptState = "SENDING" | "IN_DOUBT" | "CONFIRMED";

export interface CheckoutAttempt {
    attemptId: string;
    tenantId: string;
    userId: string;
    payload: CreateOrderRequest;
    state: AttemptState;
    orderId?: string;
    createdAt: string;
    updatedAt: string;
    retries: number;
    nextRetryAt?: number;
    // Borrador offline del que salió esta compra: se borra recién cuando la orden existe
    draftId?: string;
}

export type SubmitResult =
    | { kind: "created"; attempt: CheckoutAttempt; order: { id: string; total: number; discountApplied?: number; shippingCost?: number } }
    | { kind: "rejected"; code: string | undefined; message: string; details?: Record<string, unknown> }
    | { kind: "uncertain"; attempt: CheckoutAttempt };

const ATTEMPT_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

export const ATTEMPTS_CHANGED_EVENT = "checkout-attempts-changed";
const notifyChanged = () => {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(ATTEMPTS_CHANGED_EVENT));
};

// Si esto falla (IndexedDB abortó, almacenamiento lleno) el llamador NO debe enviar nada: un checkout que
// no se pudo guardar no es recuperable, y se lo dice al usuario en vez de afirmar que está a salvo.
export async function createAttempt(userId: string, payload: CreateOrderRequest, draftId?: string): Promise<CheckoutAttempt> {
    if (!isOfflineDbSupported()) throw new Error("IndexedDB no disponible en este navegador");
    const tenantId = getCurrentTenantId();
    if (!tenantId) throw new Error("No hay una tienda seleccionada");
    const now = new Date().toISOString();
    const attempt: CheckoutAttempt = {
        attemptId: crypto.randomUUID(),
        tenantId,
        userId,
        payload,
        state: "SENDING",
        createdAt: now,
        updatedAt: now,
        retries: 0,
        draftId,
    };
    await withOfflineStore(ATTEMPTS_STORE, "readwrite", (store) => store.add(attempt));
    notifyChanged();
    return attempt;
}

// Aislamiento: solo los de esta cuenta. Cambiar de cuenta oculta los ajenos pero no los borra, porque
// pueden ser la única referencia local de una compra incierta (la recuperación vuelve al iniciar sesión).
export async function getOwnAttempts(userId: string | null): Promise<CheckoutAttempt[]> {
    const tenantId = getCurrentTenantId();
    if (!userId || !tenantId || !isOfflineDbSupported()) return [];
    const all = await withOfflineStore<CheckoutAttempt[]>(ATTEMPTS_STORE, "readonly", (store) => store.getAll());
    return all
        .filter((attempt) => attempt.userId === userId && attempt.tenantId === tenantId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function patchAttempt(attemptId: string, patch: Partial<CheckoutAttempt>): Promise<CheckoutAttempt | undefined> {
    const saved = await patchInOfflineStore<CheckoutAttempt>(ATTEMPTS_STORE, attemptId, (current) => ({
        ...current,
        ...patch,
        updatedAt: new Date().toISOString(),
    }));
    notifyChanged();
    return saved;
}

export async function removeAttempt(attemptId: string): Promise<void> {
    await withOfflineStore(ATTEMPTS_STORE, "readwrite", (store) => store.delete(attemptId));
    notifyChanged();
}

// El pago terminó (o el comprobante se envió): ya no hay nada que recuperar de esta orden
export async function forgetAttemptsOfOrder(userId: string | null, orderId: string): Promise<void> {
    const own = await getOwnAttempts(userId).catch(() => []);
    await Promise.all(own.filter((attempt) => attempt.orderId === orderId).map((attempt) => removeAttempt(attempt.attemptId)));
}

export async function pruneOldAttempts(userId: string | null): Promise<void> {
    const own = await getOwnAttempts(userId);
    const limit = Date.now() - ATTEMPT_RETENTION_MS;
    await Promise.all(
        own
            .filter((attempt) => attempt.state === "CONFIRMED" && new Date(attempt.createdAt).getTime() < limit)
            .map((attempt) => removeAttempt(attempt.attemptId)),
    );
}

// Sin respuesta, 5xx o "en curso": el resultado se desconoce. Cualquier otro 4xx es una decisión del servidor.
export function isUncertainFailure(error: unknown): boolean {
    if (!axios.isAxiosError(error)) return false;
    if (!error.response) return true;
    if (error.response.status >= 500 || error.response.status === 408 || error.response.status === 429) return true;
    return error.response.data?.code === "ATTEMPT_IN_PROGRESS";
}

export function retryDelayMs(retries: number): number {
    const base = Math.min(5 * 60_000, 2_000 * 2 ** Math.min(retries, 8));
    return base / 2 + Math.random() * base;
}

// Misma clave + mismo snapshot: reintentar es parte del mismo intento, nunca una compra nueva.
export async function submitAttempt(attempt: CheckoutAttempt): Promise<SubmitResult> {
    try {
        const response = await OrderService.createOrder(attempt.payload, attempt.attemptId);
        const order = (response.data ?? response) as unknown as { id: string; total: number; discountApplied?: number; shippingCost?: number };
        const saved = await patchAttempt(attempt.attemptId, { state: "CONFIRMED", orderId: order.id, nextRetryAt: undefined });
        return { kind: "created", attempt: saved ?? attempt, order };
    } catch (error) {
        if (isUncertainFailure(error)) {
            const retries = attempt.retries + 1;
            const saved = await patchAttempt(attempt.attemptId, { state: "IN_DOUBT", retries, nextRetryAt: Date.now() + retryDelayMs(retries) });
            return { kind: "uncertain", attempt: saved ?? attempt };
        }
        // Decisión definitiva del servidor (sin stock, carrito o precio cambiado): nada se creó, y volver a
        // comprar exige revisar y una clave nueva
        const data = axios.isAxiosError(error) ? error.response?.data : undefined;
        await removeAttempt(attempt.attemptId);
        const message = Array.isArray(data?.message) ? data.message.join(". ") : data?.message;
        return { kind: "rejected", code: data?.code, message: message ?? (error as Error).message, details: data };
    }
}
