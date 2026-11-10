import apiClient from './client';
import { Product, ProductsApiResponse, ProductsQuery } from '../types';

export const normalizeProduct = (p: Product): Product => ({
  ...p,
  // Con sucursal seleccionada, el stock pasa a ser el stock de esa sucursal
  stock: p.branchStock !== null && p.branchStock !== undefined ? p.branchStock : p.stock,
});

export const productsApi = {
  getAll: async (query?: ProductsQuery): Promise<ProductsApiResponse> => {
    const response = await apiClient.get<ProductsApiResponse>('/products', {
      params: query,
    });
    const rawData = response.data;
    return {
      ...rawData,
      data: (rawData.data || []).map(normalizeProduct),
    };
  },

  getById: async (id: string, branchId?: string): Promise<Product> => {
    const response = await apiClient.get<Product>(`/products/${id}`, {
      params: branchId ? { branchId } : undefined,
    });
    return normalizeProduct(response.data);
  },
};

