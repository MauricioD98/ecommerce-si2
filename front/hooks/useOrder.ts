import { useState, useCallback } from "react";
import { useSelector } from "react-redux";
import type { IRootState } from "@/store";
import axios from "axios";
import { CartService } from "@/service/api/cart.service";
import { CreateOrderRequest } from "@/types/orders.types";
import { getApiErrorMessage } from "@/service/api/error.utils";
import { CheckoutAttempt, SubmitResult, createAttempt, submitAttempt } from "@/utils/checkoutAttempts";
import { removeOrderDraft } from "@/utils/offlineOrderQueue";
import { OfflineStorageError } from "@/utils/offlineDb";

export const ACTIVE_DRAFT_SESSION_KEY = "sf_active_draft";

export type CheckoutOutcome = SubmitResult | { kind: "not-saved"; quota: boolean };

export function useOrder() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const localCart = useSelector((state: IRootState) => state.cart.items);
    const userId = useSelector((state: IRootState) => state.auth.user?.id ?? null);

    // Intención nueva: sincroniza el carrito (reserva atómica), fija la revisión y GUARDA el intento antes de
    // enviar nada. Si no se pudo guardar, no se envía: no se afirma que una compra está a salvo sin estarlo.
    const startCheckout = useCallback(
        async (data: Omit<CreateOrderRequest, "cartVersion">): Promise<CheckoutOutcome> => {
            // Sin sesión no hay a quién atribuir el intento: el checkout ya redirige al login antes de llegar acá
            if (!userId) return { kind: "not-saved", quota: false };
            setLoading(true);
            setError(null);
            try {
                let cart: { version: number };
                try {
                    cart = await CartService.syncCart(
                        localCart.map((item) => ({
                            productId: item.product?.id || item.productId,
                            quantity: item.quantity,
                            selectedSize: item.selectedSize,
                        })),
                        data.branchId,
                    );
                } catch (syncError) {
                    if (axios.isAxiosError(syncError) && syncError.response && syncError.response.status < 500) {
                        const message = getApiErrorMessage(syncError, "No se pudo reservar tu carrito.");
                        setError(message);
                        return { kind: "rejected", code: syncError.response.data?.code, message };
                    }
                    throw syncError;
                }

                const draftId = typeof sessionStorage !== "undefined" ? (sessionStorage.getItem(ACTIVE_DRAFT_SESSION_KEY) ?? undefined) : undefined;
                let attempt: CheckoutAttempt;
                try {
                    attempt = await createAttempt(userId, { ...data, cartVersion: cart.version }, draftId);
                } catch (storageError) {
                    return { kind: "not-saved", quota: storageError instanceof OfflineStorageError && storageError.quota };
                }
                return await resumeCheckout(attempt);
            } finally {
                setLoading(false);
            }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [localCart, userId],
    );

    // Reintento del MISMO intento: misma clave, mismo snapshot
    const resumeCheckout = useCallback(async (attempt: CheckoutAttempt): Promise<SubmitResult> => {
        const result = await submitAttempt(attempt);
        if (result.kind === "rejected") setError(result.message);
        if (result.kind === "created" && attempt.draftId) {
            await removeOrderDraft(attempt.draftId).catch(() => undefined);
            sessionStorage.removeItem(ACTIVE_DRAFT_SESSION_KEY);
        }
        return result;
    }, []);

    return { loading, error, setError, startCheckout, resumeCheckout };
}
