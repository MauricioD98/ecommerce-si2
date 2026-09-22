import { Category } from './category.types';

export interface Product {
  id: string;
  name: string;
  description?: string | null;
  size: string;
  price: number | string;
  stock: number;
  sku: string;
  imageUrl?: string | null;
  isActive: boolean;
  categoryId: string;
  category?: Category;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductsQuery {
  page?: number;
  limit?: number;
  search?: string;
  category?: string;
  categoryId?: string;
  minPrice?: number;
  maxPrice?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface ProductsApiResponse {
  data: Product[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
