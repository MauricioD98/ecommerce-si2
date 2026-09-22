import { Product } from './product.types';

export type OrderStatus = 'PENDIENTE' | 'PROCESANDO' | 'ENVIADO' | 'ENTREGADO' | 'CANCELADO';

export interface OrderItem {
  id: string;
  orderId?: string;
  productId: string;
  quantity: number;
  price: number | string;
  product?: Product;
  productName?: string;
  subtotal?: number;
}

export interface PaymentInfo {
  id: string;
  orderId: string;
  amount: number | string;
  currency: string;
  status: 'PENDIENTE' | 'COMPLETADO' | 'FALLIDO' | 'REEMBOLSADO';
  paymentMethod?: string | null;
  transactionId?: string | null;
}

export interface Order {
  id: string;
  orderNumber?: string;
  status: OrderStatus;
  totalAmount?: number | string;
  total?: number | string;
  userId: string;
  cartId?: string | null;
  shippingAddress?: string | null;
  orderItems?: OrderItem[];
  items?: OrderItem[];
  payment?: PaymentInfo | null;
  createdAt: string;
  updatedAt?: string;
  updateAt?: string;
}

export interface CreateOrderItemInput {
  productId: string;
  quantity: number;
  price: number;
}

export interface CreateOrderPayload {
  items: CreateOrderItemInput[];
  shippingAddress?: string;
}

export interface PaginatedOrdersResponse {
  data: Order[];
  total: number;
  page: number;
  limit: number;
}
