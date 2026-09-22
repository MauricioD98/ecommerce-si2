import apiClient from './client';
import { Cart, AddCartItemPayload, UpdateCartItemPayload } from '../types';

export const cartApi = {
  getCart: async (): Promise<Cart> => {
    const response = await apiClient.get<Cart>('/cart');
    return response.data;
  },

  addItem: async (payload: AddCartItemPayload): Promise<Cart> => {
    const response = await apiClient.post<Cart>('/cart/items', payload);
    return response.data;
  },

  updateItemQuantity: async (itemId: string, payload: UpdateCartItemPayload): Promise<Cart> => {
    const response = await apiClient.patch<Cart>(`/cart/items/${itemId}`, payload);
    return response.data;
  },

  removeItem: async (itemId: string): Promise<Cart> => {
    const response = await apiClient.delete<Cart>(`/cart/items/${itemId}`);
    return response.data;
  },

  clearCart: async (): Promise<Cart> => {
    const response = await apiClient.delete<Cart>('/cart');
    return response.data;
  },
};
