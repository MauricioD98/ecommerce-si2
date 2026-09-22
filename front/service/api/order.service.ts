import { apiClient } from "./axios.config";
// IMPORTANTE: Ajusta la ruta a tu archivo de tipos de órdenes
import { CreateOrderRequest, OrderResponse, PaginatedMyOrders } from "@/types/orders.types";
import { AdminOrder, OrderStatus, PaginatedOrders } from "@/types/admin.types";

export const OrderService = {
    createOrder: async (data: CreateOrderRequest): Promise<OrderResponse> => {
        // El backend calcula los precios: solo se envían productId, quantity y la talla elegida (como `size`)
        const payload = {
            ...data,
            items: data.items.map(({ productId, quantity, selectedSize }) => ({
                productId,
                quantity,
                size: selectedSize,
            })),
        };
        const response = await apiClient.post<OrderResponse>("/orders", payload);
        return response.data;
    },

    // Pedido del usuario actual (para la página de éxito del pago o el detalle de "Mis pedidos")
    getOrder: async (id: string): Promise<OrderResponse> => {
        const response = await apiClient.get<OrderResponse>(`/orders/${id}`);
        return response.data;
    },

    // Historial de pedidos del cliente autenticado (paginado, más recientes primero)
    getMyOrders: async (page = 1, limit = 10, status?: string): Promise<PaginatedMyOrders> => {
        const response = await apiClient.get<PaginatedMyOrders>("/orders/me", {
            params: { page, limit, ...(status ? { status } : {}) },
        });
        return response.data;
    },

    // Panel admin: el backend ya filtra por sucursal cuando el usuario es ADMIN_SUCURSAL
    getAdminOrders: async (page = 1, limit = 10): Promise<PaginatedOrders> => {
        const response = await apiClient.get<PaginatedOrders>("/orders/admin/all", {
            params: { page, limit },
        });
        return response.data;
    },

    updateOrderStatus: async (id: string, status: OrderStatus): Promise<AdminOrder> => {
        const response = await apiClient.patch<{ data: AdminOrder }>(`/orders/admin/${id}`, { status });
        return response.data.data;
    },

    // Cancela el pedido y devuelve el stock a la sucursal (solo pedidos pendientes)
    cancelAdminOrder: async (id: string): Promise<AdminOrder> => {
        const response = await apiClient.delete<{ data: AdminOrder }>(`/orders/admin/${id}`);
        return response.data.data;
    },
};