import { useState, useCallback } from "react";
import { useSelector } from "react-redux";
import axios from "axios";
import { CartService } from "@/service/api/cart.service";
import { OrderService } from "@/service/api/order.service";
import { CreateOrderRequest } from "@/types/orders.types";
import { getApiErrorMessage } from "@/service/api/error.utils";

export function useOrder() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [order, setOrder] = useState<any | null>(null);

    const guestCart = useSelector((state: any) => state.cart.items);

    const createOrder = useCallback(
        async (data: CreateOrderRequest): Promise<any> => {
            setLoading(true);
            setError(null);
            try {
                if (guestCart.length > 0) {
                    try {
                        await CartService.mergeCart(
                            guestCart.map((item: any) => ({
                                productId: item.product?.id || item.productId,
                                quantity: item.quantity,
                                selectedSize: item.selectedSize,
                            })),
                            data.branchId
                        );
                    } catch (cartErr) {
                        console.warn("No se pudo pre-sincronizar el carrito del servidor (continuando):", cartErr);
                    }
                }

                const response = await OrderService.createOrder(data);
                const orderData = response.data ? response.data : response;

                if (!orderData) {
                    throw new Error("El backend respondió sin datos de la orden creada.");
                }

                setOrder(orderData);
                return orderData;
            } catch (error) {
                // console.warn evita abrir el overlay de errores de consola de Next.js en desarrollo
                // cuando el backend rechaza con un error controlado (400/403), mostrando el aviso en la UI.
                if (axios.isAxiosError(error)) {
                    console.warn("POST /orders rechazado:", data, "Respuesta:", error.response?.status, error.response?.data);
                } else {
                    console.warn("Error inesperado al crear la orden:", error);
                }
                const errorMessage = getApiErrorMessage(error, "No se pudo crear el pedido. Inténtalo de nuevo.");
                setError(errorMessage);
                throw new Error(errorMessage);
            } finally {
                setLoading(false);
            }
        },
        [guestCart]
    );

    return {
        loading,
        error,
        createOrder,
        order
    };
}
