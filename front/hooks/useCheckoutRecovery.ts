import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { useSelector } from "react-redux";
import type { IRootState } from "@/store";
import { OrderService } from "@/service/api/order.service";
import {
    ATTEMPTS_CHANGED_EVENT,
    CheckoutAttempt,
    getOwnAttempts,
    isUncertainFailure,
    patchAttempt,
    pruneOldAttempts,
    removeAttempt,
    retryDelayMs,
    submitAttempt,
} from "@/utils/checkoutAttempts";
import { getCurrentTenantId } from "@/utils/tenant";
import { removeOrderDraft } from "@/utils/offlineOrderQueue";

const POLL_MS = 30_000;
const SENDING_GRACE_MS = 15_000;

// Al arrancar, volver a primer plano o reconectar, recupera los intentos de la cuenta actual. navigator.onLine
// es solo una señal: la API puede seguir inaccesible, así que un fallo solo reprograma con backoff y jitter.
// Un 404 de la consulta NO prueba que no se haya comprado: se reenvía con la MISMA clave, nunca otra.
export function useCheckoutRecovery() {
    const userId = useSelector((state: IRootState) => state.auth.user?.id ?? null);
    const [inDoubt, setInDoubt] = useState<CheckoutAttempt[]>([]);
    const running = useRef(false);

    const refresh = useCallback(async () => {
        try {
            const own = await getOwnAttempts(userId);
            // Un envío en curso todavía no es incierto: solo si el proceso que lo enviaba ya no puede responder
            const staleBefore = Date.now() - SENDING_GRACE_MS;
            setInDoubt(own.filter((attempt) => attempt.state === "IN_DOUBT" || (attempt.state === "SENDING" && new Date(attempt.updatedAt).getTime() < staleBefore)));
        } catch {
            setInDoubt([]);
        }
    }, [userId]);

    const recoverOne = useCallback(async (attempt: CheckoutAttempt) => {
        try {
            const { data } = await OrderService.getAttempt(attempt.attemptId);
            if (data.status === "SUCCEEDED" && data.orderId) {
                await patchAttempt(attempt.attemptId, { state: "CONFIRMED", orderId: data.orderId, nextRetryAt: undefined });
                if (attempt.draftId) await removeOrderDraft(attempt.draftId).catch(() => undefined);
                return;
            }
            if (data.status === "REJECTED") {
                await removeAttempt(attempt.attemptId);
                return;
            }
        } catch (error) {
            const notFound = axios.isAxiosError(error) && error.response?.status === 404;
            if (!notFound) {
                // Sesión vencida o API inaccesible: se reintenta después. La sesión de otra cuenta no llega acá
                if (isUncertainFailure(error)) {
                    const retries = attempt.retries + 1;
                    await patchAttempt(attempt.attemptId, { retries, nextRetryAt: Date.now() + retryDelayMs(retries) });
                }
                return;
            }
        }
        const result = await submitAttempt(attempt);
        if (result.kind === "created" && attempt.draftId) await removeOrderDraft(attempt.draftId).catch(() => undefined);
    }, []);

    const recover = useCallback(async () => {
        if (running.current || !userId || !getCurrentTenantId()) return;
        running.current = true;
        try {
            const work = async () => {
                const own = await getOwnAttempts(userId);
                const now = Date.now();
                for (const attempt of own) {
                    if (attempt.state === "CONFIRMED") continue;
                    // Un SENDING muy reciente puede estar en vuelo en esta u otra pestaña: se le da margen
                    if (attempt.state === "SENDING" && now - new Date(attempt.updatedAt).getTime() < SENDING_GRACE_MS) continue;
                    if (attempt.nextRetryAt && attempt.nextRetryAt > now) continue;
                    await recoverOne(attempt);
                }
                await pruneOldAttempts(userId);
            };
            // Coordina pestañas para no duplicar trabajo. La corrección no depende de esto: la garantiza la BD.
            if (typeof navigator !== "undefined" && navigator.locks) {
                await navigator.locks.request(`sf-checkout-recovery:${getCurrentTenantId()}:${userId}`, { ifAvailable: true }, async (lock) => {
                    if (lock) await work();
                });
            } else {
                await work();
            }
        } catch {
            // Almacenamiento no disponible: lo que el servidor sabe sigue a salvo, y se mira en /account/orders
        } finally {
            running.current = false;
            await refresh();
        }
    }, [userId, recoverOne, refresh]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        refresh();
        recover();
        const onVisible = () => {
            if (document.visibilityState === "visible") recover();
        };
        window.addEventListener("online", recover);
        window.addEventListener("focus", recover);
        window.addEventListener(ATTEMPTS_CHANGED_EVENT, refresh);
        document.addEventListener("visibilitychange", onVisible);
        const timer = setInterval(recover, POLL_MS);
        return () => {
            window.removeEventListener("online", recover);
            window.removeEventListener("focus", recover);
            window.removeEventListener(ATTEMPTS_CHANGED_EVENT, refresh);
            document.removeEventListener("visibilitychange", onVisible);
            clearInterval(timer);
        };
    }, [recover, refresh]);

    return { inDoubt, recoverNow: recover };
}
