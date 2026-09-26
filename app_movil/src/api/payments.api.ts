import apiClient from './client';
import {
  CreatePaymentIntentPayload,
  CreatePaymentIntentResponse,
  ConfirmPaymentPayload,
  PaymentDetails,
  GenerateQrResponse,
  QrStatusResponse,
  ConfirmQrPayload,
} from '../types';

export const paymentsApi = {
  createIntent: async (payload: CreatePaymentIntentPayload): Promise<CreatePaymentIntentResponse> => {
    const response = await apiClient.post<CreatePaymentIntentResponse>('/payments/create-intent', payload);
    return response.data;
  },

  confirmPayment: async (payload: ConfirmPaymentPayload): Promise<{ success: boolean; data: PaymentDetails; message: string }> => {
    const response = await apiClient.post<{ success: boolean; data: PaymentDetails; message: string }>('/payments/confirm', payload);
    return response.data;
  },

  generateQr: async (orderId: string): Promise<GenerateQrResponse> => {
    const response = await apiClient.post<GenerateQrResponse>('/payments/qr/generate', { orderId });
    return response.data;
  },

  getQrStatus: async (orderId: string): Promise<QrStatusResponse> => {
    const response = await apiClient.get<QrStatusResponse>(`/payments/qr/status/${orderId}`);
    return response.data;
  },

  confirmQrPayment: async (payload: ConfirmQrPayload): Promise<{ success: boolean; data: any; message: string }> => {
    const response = await apiClient.post<{ success: boolean; data: any; message: string }>('/payments/qr/confirm', payload);
    return response.data;
  },

  getByOrderId: async (orderId: string): Promise<PaymentDetails | null> => {
    try {
      const response = await apiClient.get<{ data?: PaymentDetails } | PaymentDetails>(`/payments/order/${orderId}`);
      if ('data' in response.data && response.data.data) {
        return response.data.data;
      }
      return response.data as PaymentDetails;
    } catch {
      return null;
    }
  },

  getAll: async (): Promise<PaymentDetails[]> => {
    const response = await apiClient.get<PaymentDetails[]>('/payments');
    return response.data;
  },
};

