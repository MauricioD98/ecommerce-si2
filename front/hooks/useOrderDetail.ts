import { useEffect, useState } from "react";
import { OrderService } from "@/service/api/order.service";
import { getApiErrorMessage } from "@/service/api/error.utils";
import { Order } from "@/types/orders.types";

// Detalle de un pedido propio (usado por la página de tracking en "Mis pedidos")
export function useOrderDetail(orderId: string | undefined) {
    const [order, setOrder] = useState<Order | null>(null);
    const [loadedId, setLoadedId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!orderId) return;
        let active = true;

        OrderService.getOrder(orderId)
            .then((response) => {
                if (!active) return;
                setOrder(response.data);
                setError(null);
            })
            .catch((error) => {
                if (active) setError(getApiErrorMessage(error, "No se pudo cargar el pedido."));
            })
            .finally(() => {
                if (active) setLoadedId(orderId);
            });

        return () => {
            active = false;
        };
    }, [orderId]);

    return { order, isLoading: loadedId !== orderId, error };
}
