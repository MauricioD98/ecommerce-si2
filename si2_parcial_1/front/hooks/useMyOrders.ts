import { useEffect, useState } from "react";
import { OrderService } from "@/service/api/order.service";
import { getApiErrorMessage } from "@/service/api/error.utils";
import { Order, PaginatedMyOrders } from "@/types/orders.types";

const PAGE_SIZE = 10;

// Historial de pedidos del cliente ("Mis pedidos"), paginado y ordenado del más reciente al más antiguo
export function useMyOrders(page: number) {
    const [orders, setOrders] = useState<Order[]>([]);
    const [total, setTotal] = useState(0);
    const [loadedPage, setLoadedPage] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;

        OrderService.getMyOrders(page, PAGE_SIZE)
            .then((response: PaginatedMyOrders) => {
                if (!active) return;
                setOrders(response.data);
                setTotal(response.total);
                setError(null);
            })
            .catch((error) => {
                if (active) setError(getApiErrorMessage(error, "No se pudieron cargar tus pedidos."));
            })
            .finally(() => {
                if (active) setLoadedPage(page);
            });

        return () => {
            active = false;
        };
    }, [page]);

    return {
        orders,
        total,
        totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
        isLoading: loadedPage !== page,
        error,
    };
}
