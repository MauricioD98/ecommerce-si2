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

export interface WalletPaymentOption {
  provider: string;
  account: string;
  instructions: string;
}

export interface PaymentOptions {
  // La tienda cobra con su cuenta Stripe Connect habilitada
  card: boolean;
  // La app no tiene SDK de Stripe: la tarjeta solo existe como simulación de desarrollo explícita
  simulatedCard?: boolean;
  simulatedQr?: boolean;
  wallet?: WalletPaymentOption | null;
}

export const paymentsApi = {
  createIntent: async (payload: CreatePaymentIntentPayload): Promise<CreatePaymentIntentResponse> => {
    const response = await apiClient.post<CreatePaymentIntentResponse>('/payments/create-intent', payload);
    return response.data;
  },

  confirmPayment: async (payload: ConfirmPaymentPayload): Promise<{ success: boolean; data: PaymentDetails; message: string; simulated?: boolean }> => {
    const response = await apiClient.post<{ success: boolean; data: PaymentDetails; message: string; simulated?: boolean }>('/payments/confirm', payload);
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

  submitProof: async (
    orderId: string,
    method: string,
    input: { txId?: string; file?: any },
  ): Promise<{ success: boolean; data: any; message: string }> => {
    const formData = new FormData();
    formData.append('method', method);
    if (input.txId) formData.append('txId', input.txId.trim());
    if (input.file) formData.append('file', input.file as any);
    const response = await apiClient.post<{ success: boolean; data: any; message: string }>(
      `/orders/${orderId}/payment-proof`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return response.data;
  },

  // Medios activos de la tienda. El QR simulado solo existe en entornos de prueba explícitos.
  // wallet llega en null si la billetera está desactivada, incompleta o fuera del plan.
  getOptions: async (): Promise<PaymentOptions> => {
    const response = await apiClient.get<{ data: PaymentOptions }>('/store/payment-options');
    return response.data.data;
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

