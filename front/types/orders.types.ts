import { FulfillmentType } from "./branch.types";

export interface OrderItem {
    productId: string;
    quantity: number;
    selectedSize?: string;
    // El backend calcula los precios: no hace falta enviarlo
    price?: number;
}

export interface CreateOrderRequest {
    // Revisión del carrito sobre la que el usuario confirmó y total que aceptó: el servidor los valida
    cartVersion: number;
    expectedTotal?: number;
    items: OrderItem[];
    shippingAddress?: string;
    // Ubicación exacta de entrega (solo DELIVERY): se envían juntas
    latitude?: number;
    longitude?: number;
    fulfillmentType: FulfillmentType;
    branchId?: string;
    // CreateOrderDto acepta QR, BANK_QR o USDT. Para Stripe se omite (STRIPE es el default del
    // esquema); mandar "STRIPE" aquí da 400.
    paymentMethod?: "QR" | "BANK_QR" | "USDT" | "WALLET";
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

// Comprobante de un pago manual (QR bancario / USDT); la imagen se pide aparte
export interface PaymentProofSummary {
    status: "PENDIENTE" | "APROBADO" | "RECHAZADO";
    method: "BANK_QR" | "USDT" | "WALLET";
    txId: string | null;
    hasImage: boolean;
    createdAt: string;
    reviewedAt: string | null;
}

export interface Order {
    id: string;
    // Número del pedido (el de los correos); falta en respuestas de una API anterior
    orderNumber?: string;
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
    paymentMethod?: string;
    paymentProof?: PaymentProofSummary | null;
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