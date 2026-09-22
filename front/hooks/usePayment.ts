import { useState, useCallback } from 'react';
import { PaymentService } from '@/service/api/payment.service';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { CreatePaymentIntentRequest, ConfirmPaymentRequest } from '@/types/payment.types';

export function usePayment() {
    const [clientSecret, setClientSecret] = useState<string | null>(null);
    const [isLoading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [paymentId, setPaymentId] = useState<string | null>(null);

    const createPaymentIntent = useCallback(
        async (data: CreatePaymentIntentRequest): Promise<boolean> => {
            setLoading(true);
            setError(null);
            try {
                const response = await PaymentService.createPaymentIntent(data);
                if (response.success && response.data) {
                    setClientSecret(response.data.clientSecret);
                    setPaymentId(response.data.paymentId);
                    return true;
                }
                throw new Error(response.message || "Failed to create payment");
            } catch (error) {
                // Muestra el mensaje real de la API (ej. "Order not found") en vez de uno genérico
                setError(getApiErrorMessage(error, "No se pudo iniciar el pago. Inténtalo de nuevo."));
                return false;
            } finally {
                setLoading(false);
            }
        },
        []
    );

    const confirmPayment = useCallback(
        async (data: ConfirmPaymentRequest): Promise<boolean> => {
            setLoading(true);
            setError(null);
            try {
                const response = await PaymentService.confirmPayment(data);
                if (response.success) {
                    return true;
                }
                throw new Error(response.message || "Failed to confirm payment");
            } catch (error) {
                setError(getApiErrorMessage(error, "No se pudo confirmar el pago. Inténtalo de nuevo."));
                return false;
            } finally {
                setLoading(false);
            }
        },
        []
    );

    return { clientSecret, paymentId, isLoading, error, createPaymentIntent, confirmPayment };
}