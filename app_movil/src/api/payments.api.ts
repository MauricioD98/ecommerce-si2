import apiClient from './client';
import {
  CreatePaymentIntentPayload,
  CreatePaymentIntentResponse,
  ConfirmPaymentPayload,
  PaymentDetails,
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
