import { apiClient } from "./axios.config";
import {
    CreatePaymentIntentRequest,
    ConfirmPaymentRequest,
    PaymentResponse,
    GenerateQrResponse,
    QrStatusResponse,
} from "@/types/payment.types";

export const PaymentService = {
    createPaymentIntent: async (
        data: CreatePaymentIntentRequest
    ): Promise<PaymentResponse> => {
        const response = await apiClient.post<PaymentResponse>("/payments/create-intent", data);
        return response.data;
    },

    confirmPayment: async (
        data: ConfirmPaymentRequest
    ): Promise<PaymentResponse> => {
        const response = await apiClient.post<PaymentResponse>("/payments/confirm", data);
        return response.data;
    },

    generateQr: async (orderId: string): Promise<GenerateQrResponse> => {
        const response = await apiClient.post<GenerateQrResponse>("/payments/qr/generate", { orderId });
        return response.data;
    },

    getQrStatus: async (orderId: string): Promise<QrStatusResponse> => {
        const response = await apiClient.get<QrStatusResponse>(`/payments/qr/status/${orderId}`);
        return response.data;
    },

    confirmQrPayment: async (orderId: string, transactionId?: string): Promise<{ success: boolean; data: any; message: string }> => {
        const response = await apiClient.post<{ success: boolean; data: any; message: string }>("/payments/qr/confirm", {
            orderId,
            transactionId,
        });
        return response.data;
    },
};

export type { ConfirmPaymentRequest, CreatePaymentIntentRequest, PaymentResponse, GenerateQrResponse, QrStatusResponse };