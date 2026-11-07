import { useEffect, useState } from "react";
import { OrderService } from "@/service/api/order.service";
import { getApiErrorMessage } from "@/service/api/error.utils";
import { useLocaleVersion } from "@/hooks/useLocaleVersion";
import { useTranslations } from "next-intl";
import { Order, PaginatedMyOrders } from "@/types/orders.types";
import { cacheOrdersPage, getCachedOrdersPage, isNetworkFailure } from "@/utils/offlineOrders";

const PAGE_SIZE = 10;

// Historial de pedidos del cliente ("Mis pedidos"), paginado y ordenado del más reciente al más antiguo
export function useMyOrders(page: number) {
    const [orders, setOrders] = useState<Order[]>([]);
    const [total, setTotal] = useState(0);
    const [loadedPage, setLoadedPage] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    // Sin red: fecha de la copia guardada que se está mostrando (null = datos del servidor)
    const [offlineCopyAt, setOfflineCopyAt] = useState<string | null>(null);
    // Los nombres de producto de cada pedido vienen traducidos: se recargan al cambiar de idioma
    const localeVersion = useLocaleVersion();
    const t = useTranslations("Account.orders");

    useEffect(() => {
        let active = true;

        OrderService.getMyOrders(page, PAGE_SIZE)
            .then((response: PaginatedMyOrders) => {
                if (!active) return;
                setOrders(response.data);
                setTotal(response.total);
                setError(null);
                setOfflineCopyAt(null);
                // Copia para consultarla sin conexión (IndexedDB, solo de esta cuenta y tienda)
                void cacheOrdersPage(page, PAGE_SIZE, response.data, response.total);
            })
            .catch(async (error) => {
                // Sin respuesta del servidor: se muestra lo último que se vio, avisando que es una copia
                const cached = isNetworkFailure(error) ? await getCachedOrdersPage(page) : null;
                if (!active) return;
                if (cached) {
                    setOrders(cached.data);
                    setTotal(cached.total);
                    setOfflineCopyAt(cached.savedAt);
                    setError(null);
                } else {
                    setError(isNetworkFailure(error) && !navigator.onLine ? t("offlineNoCopy") : getApiErrorMessage(error, t("loadFailed")));
                }
            })
            .finally(() => {
                if (active) setLoadedPage(page);
            });

        return () => {
            active = false;
        };
        // t cambia junto con localeVersion: no hace falta como dependencia aparte
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page, localeVersion]);

    return {
        orders,
        total,
        totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
        isLoading: loadedPage !== page,
        error,
        offlineCopyAt,
    };
}
