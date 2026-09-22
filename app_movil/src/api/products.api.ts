import apiClient from './client';
import { Product, ProductsApiResponse, ProductsQuery } from '../types';

export const productsApi = {
  getAll: async (query?: ProductsQuery): Promise<ProductsApiResponse> => {
    const response = await apiClient.get<ProductsApiResponse>('/products', {
      params: query,
    });
    return response.data;
  },

  getById: async (id: string): Promise<Product> => {
    const response = await apiClient.get<Product>(`/products/${id}`);
    return response.data;
  },
};
