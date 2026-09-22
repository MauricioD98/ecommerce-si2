import { useState, useCallback } from "react";
import { useSelector } from "react-redux";
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
        async (data: CreateOrderRequest): Promise<any | null> => {
            setLoading(true);
            setError(null);
            try {
                if (guestCart.length > 0) {
                    await CartService.mergeCart(
                        guestCart.map((item: any) => ({
                            productId: item.product?.id || item.productId,
                            quantity: item.quantity,
                            selectedSize: item.selectedSize,
                        })),
                        data.branchId
                    );
                }

                const response = await OrderService.createOrder(data);
                const orderData = response.data ? response.data : response;

                if (orderData) {
                    setOrder(orderData);
                    return orderData;
                }

                throw new Error("Failed to create order");
            } catch (error) {
                const errorMessage = getApiErrorMessage(error, "No se pudo crear el pedido. Inténtalo de nuevo.");
                setError(errorMessage);
                return null;
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