import apiClient from './client';
import { CreateOrderPayload, Order, PaginatedOrdersResponse } from '../types';

export const ordersApi = {
  // La clave nace una vez por intención de compra (utils/checkoutAttempts.ts) y se repite en cada reintento
  create: async (payload: CreateOrderPayload, idempotencyKey: string): Promise<Order> => {
    const response = await apiClient.post<{ data?: Order } | Order>('/orders', payload, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    if ('data' in response.data && response.data.data) {
      return response.data.data;
    }
    return response.data as Order;
  },

  // Estado de un intento propio. 404 no prueba que no exista: un POST puede seguir en vuelo.
  getAttempt: async (key: string): Promise<{ status: 'IN_PROGRESS' | 'SUCCEEDED' | 'REJECTED'; orderId: string | null; resultCode: string | null }> => {
    const response = await apiClient.get(`/orders/attempts/${encodeURIComponent(key)}`);
    return response.data.data;
  },

  getAll: async (params?: { status?: string; page?: number; limit?: number }): Promise<PaginatedOrdersResponse> => {
    const response = await apiClient.get<PaginatedOrdersResponse>('/orders', { params });
    return response.data;
  },

  getById: async (id: string): Promise<Order> => {
    const response = await apiClient.get<{ data?: Order } | Order>(`/orders/${id}`);
    if ('data' in response.data && response.data.data) {
      return response.data.data;
    }
    return response.data as Order;
  },

  cancel: async (id: string): Promise<Order> => {
    const response = await apiClient.delete<{ data?: Order } | Order>(`/orders/${id}`);
    if ('data' in response.data && response.data.data) {
      return response.data.data;
    }
    return response.data as Order;
  },
};
