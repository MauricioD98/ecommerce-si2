export interface CreatePaymentIntentPayload {
  orderId: string;
  amount: number;
  currency?: string;
  description?: string;
}

export interface CreatePaymentIntentResponse {
  success: boolean;
  data: {
    clientSecret: string;
    paymentId: string;
  };
  message: string;
}

export interface ConfirmPaymentPayload {
  paymentIntentId: string;
  orderId: string;
}

export interface PaymentDetails {
  id: string;
  amount: number | string;
  currency: string;
  status: 'PENDIENTE' | 'COMPLETADO' | 'FALLIDO' | 'REEMBOLSADO';
  paymentMethod?: string | null;
  transactionId?: string | null;
  orderId: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
}
