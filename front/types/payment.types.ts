export interface CreatePaymentIntentRequest {
    orderId: string;
    description?: string;
    currency?: string;
}

export interface CreatePaymentIntentResponse {
    clientSecret: string;
    paymentId: string;
}

export interface PaymentResponse {
    success: boolean;
    message: string;
    data: CreatePaymentIntentResponse;

}

export interface ConfirmPaymentRequest {
    paymentIntentId: string;
    orderId: string;
}

export interface GenerateQrResponse {
    success: boolean;
    message: string;
    data: {
        orderId: string;
        orderNumber: number;
        amount: number;
        qrDataUrl: string;
        confirmUrl: string;
        status: string;
    };
}

export interface QrStatusResponse {
    success: boolean;
    status: string;
    isPaid: boolean;
    orderId: string;
    orderNumber: number;
    totalAmount: number;
}
