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
