import { useState, useCallback } from "react";
import { useSelector } from "react-redux";
import axios from "axios";
import { CartService } from "@/service/api/cart.service";
import { OrderService } from "@/service/api/order.service";
import { CreateOrderRequest, OrderResponse } from "@/types/orders.types";
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
                // Log del payload enviado + el mensaje EXACTO que devuelve NestJS (ej. errores de
                // class-validator del DTO como "size should not be empty"), no uno genérico.
                if (axios.isAxiosError(error)) {
                    console.error("POST /orders falló. Payload enviado:", data, "Respuesta del backend:", error.response?.status, error.response?.data);
                } else {
                    console.error("Error inesperado al crear la orden:", error);
                }
                const errorMessage = getApiErrorMessage(error, "No se pudo crear el pedido. Inténtalo de nuevo.");
                setError(errorMessage);
                // Se relanza con el mensaje real (en vez de devolver null): así el `catch` de
                // CheckoutClient recibe el motivo exacto en `error.message`, no un texto fijo.
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