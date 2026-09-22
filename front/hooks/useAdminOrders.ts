import { useEffect, useState } from "react";
import { OrderService } from "@/service/api/order.service";
import { getApiErrorMessage } from "@/service/api/error.utils";
import { AdminOrder, OrderStatus } from "@/types/admin.types";

const PAGE_SIZE = 10;

// Pedidos del panel admin, paginados (el backend filtra por sucursal para ADMIN_SUCURSAL)
export function useAdminOrders(page: number) {
    const [orders, setOrders] = useState<AdminOrder[]>([]);
    const [total, setTotal] = useState(0);
    const [loadedPage, setLoadedPage] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;

        OrderService.getAdminOrders(page, PAGE_SIZE)
            .then((response) => {
                if (!active) return;
                setOrders(response.data);
                setTotal(response.total);
                setError(null);
            })
            .catch((error) => {
                if (active) setError(getApiErrorMessage(error, "No se pudieron cargar los pedidos."));
            })
            .finally(() => {
                if (active) setLoadedPage(page);
            });

        return () => {
            active = false;
        };
    }, [page]);

    const replaceOrder = (updated: AdminOrder) => {
        // La respuesta de actualización trae el pedido completo; se conserva lo ya cargado por si falta algo
        setOrders((prev) => prev.map((order) => (order.id === updated.id ? { ...order, ...updated } : order)));
    };

    // Las acciones lanzan el error para que la tabla lo muestre
    const changeStatus = async (id: string, status: OrderStatus) => {
        replaceOrder(await OrderService.updateOrderStatus(id, status));
    };

    const cancelOrder = async (id: string) => {
        replaceOrder(await OrderService.cancelAdminOrder(id));
    };

    return {
        orders,
        total,
        totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
        isLoading: loadedPage !== page,
        error,
        changeStatus,
        cancelOrder,
    };
}
