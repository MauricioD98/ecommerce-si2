import apiClient from './client';
import { CreateOrderPayload, Order, PaginatedOrdersResponse } from '../types';

export const ordersApi = {
  create: async (payload: CreateOrderPayload): Promise<Order> => {
    const response = await apiClient.post<{ data?: Order } | Order>('/orders', payload);
    if ('data' in response.data && response.data.data) {
      return response.data.data;
    }
    return response.data as Order;
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
