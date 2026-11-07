import { useEffect, useState } from "react";
import { OrderService } from "@/service/api/order.service";
import { getApiErrorMessage } from "@/service/api/error.utils";
import { useLocaleVersion } from "@/hooks/useLocaleVersion";
import { useTranslations } from "next-intl";
import { Order } from "@/types/orders.types";
import { cacheOrderDetail, getCachedOrder, isNetworkFailure } from "@/utils/offlineOrders";

// Detalle de un pedido propio (usado por la página de tracking en "Mis pedidos")
export function useOrderDetail(orderId: string | undefined) {
    const [order, setOrder] = useState<Order | null>(null);
    const [loadedId, setLoadedId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [offlineCopyAt, setOfflineCopyAt] = useState<string | null>(null);
    // Para volver a leer el pedido (p. ej. después de enviar el comprobante de pago)
    const [version, setVersion] = useState(0);
    // Los nombres de producto vienen traducidos: se recarga al cambiar de idioma
    const localeVersion = useLocaleVersion();
    const t = useTranslations("Account.orders");

    useEffect(() => {
        if (!orderId) return;
        let active = true;

        OrderService.getOrder(orderId)
            .then((response) => {
                if (!active) return;
                setOrder(response.data);
                setError(null);
                setOfflineCopyAt(null);
                void cacheOrderDetail(response.data);
            })
            .catch(async (error) => {
                const cached = isNetworkFailure(error) ? await getCachedOrder(orderId) : null;
                if (!active) return;
                if (cached) {
                    setOrder(cached.order);
                    setOfflineCopyAt(cached.savedAt);
                    setError(null);
                } else {
                    setError(isNetworkFailure(error) && !navigator.onLine ? t("offlineNoCopy") : getApiErrorMessage(error, t("loadOneFailed")));
                }
            })
            .finally(() => {
                if (active) setLoadedId(orderId);
            });

        return () => {
            active = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orderId, localeVersion, version]);

    return { order, isLoading: loadedId !== orderId, error, offlineCopyAt, reload: () => setVersion((v) => v + 1) };
}
