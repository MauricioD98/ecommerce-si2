import { Product } from './product.types';

export interface CartItem {
  id: string;
  cartId: string;
  productId: string;
  quantity: number;
  product: Product;
}

export interface Cart {
  id: string;
  userId: string;
  checkout: boolean;
  cartItems: CartItem[];
  total: number;
  createdAt: string;
  updatedAt: string;
}

export interface AddCartItemPayload {
  productId: string;
  quantity: number;
}

export interface UpdateCartItemPayload {
  quantity: number;
}
