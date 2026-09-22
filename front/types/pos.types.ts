export type PosPaymentMethod = "CASH" | "PHYSICAL_CARD" | "QR";

export interface PosCheckoutItem {
    productId: string;
    quantity: number;
}

export interface PosCheckoutPayload {
    items: PosCheckoutItem[];
    paymentMethod: PosPaymentMethod;
    // Monto en efectivo recibido (solo CASH); el servidor calcula y valida el cambio
    amountReceived?: number;
    customerId?: string;
    branchId?: string;
    // Datos de facturación
    nit?: string;
    razonSocial?: string;
    notes?: string;
}

export interface PosReceiptItem {
    productName: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
}

export interface PosReceipt {
    orderId: string;
    orderNumber: string;
    items: PosReceiptItem[];
    subtotal: number;
    discountApplied: number;
    total: number;
    paymentMethod: PosPaymentMethod;
    branchName: string;
    cashierName: string;
    customerName: string;
    nit: string | null;
    razonSocial: string | null;
    amountReceived: number | null;
    change: number | null;
    createdAt: string;
}

export interface PosCheckoutResponse {
    success: boolean;
    message?: string;
    data: PosReceipt;
}
