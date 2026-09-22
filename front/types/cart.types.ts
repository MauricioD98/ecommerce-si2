import { Product } from "./product.types";

export interface CartItem {
    id: string;
    cartId: string;
    productId: string;
    product: Product;
    price: number;
    quantity: number;
    selectedSize?: string;
    CreatedAt: string;
    updateAt: string;
}

export interface CartState {
    items: CartItem[];
    totalItems: number;
    totalPrice: number;
}

export interface CartResponse {
    success: boolean;
    message: string;
    data: unknown;
}
