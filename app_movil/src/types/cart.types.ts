import { Product } from './product.types';

export interface CartItem {
  id: string;
  cartId: string;
  productId: string;
  quantity: number;
  size?: string | null;
  product: Product;
}

export interface Cart {
  id: string;
  userId: string;
  checkout: boolean;
  // Revisión: sube con cada cambio. La compra se confirma contra una revisión exacta.
  version: number;
  cartItems: CartItem[];
  total: number;
  createdAt: string;
  updatedAt: string;
}

export interface AddCartItemPayload {
  productId: string;
  quantity: number;
  size?: string;
  branchId?: string;
}

export interface UpdateCartItemPayload {
  quantity: number;
}
