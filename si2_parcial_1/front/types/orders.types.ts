import { FulfillmentType } from "./branch.types";

export interface OrderItem {
    productId: string;
    quantity: number;
    selectedSize?: string;
    // El backend calcula los precios: no hace falta enviarlo
    price?: number;
}

export interface CreateOrderRequest {
    items: OrderItem[];
    shippingAddress?: string;
    // Ubicación exacta de entrega (solo DELIVERY): se envían juntas
    latitude?: number;
    longitude?: number;
    fulfillmentType: FulfillmentType;
    branchId?: string;
    // Solo para checkout sin Stripe (pedido guardado offline y sincronizado luego). Omitido, usa STRIPE.
    paymentMethod?: "QR";
}

export interface OrderItemDetail {
    id: string;
    productId: string;
    productName: string;
    // Talla comprada (null si el producto no maneja tallas o el pedido es anterior a esta funcionalidad)
    size: string | null;
    quantity: number;
    price: number;
    subtotal: number;
}

export interface Order {
    id: string;
    userId: string;
    shippingAddress: string;
    fulfillmentType: FulfillmentType;
    latitude: number | null;
    longitude: number | null;
    branchId: string | null;
    // Total final (con descuentos de producto y de trabajador, más envío) y monto del descuento de trabajador
    total: number;
    // Costo de envío ya incluido en `total` (0 en retiro en sucursal)
    shippingCost: number;
    discountApplied: number;
    status: string;
    paymentStatus: string;
    items: OrderItemDetail[];
    createdAt: string;
    updateAt: string;
}

export interface OrderResponse {
    success: boolean;
    message: string;
    data: Order
}

export interface PaginatedMyOrders {
    data: Order[];
    total: number;
    page: number;
    limit: number;
}