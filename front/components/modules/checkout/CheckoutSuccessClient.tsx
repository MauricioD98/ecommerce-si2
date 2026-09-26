'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check } from 'lucide-react';
import styles from './checkout.module.scss';
import { useCart } from '@/hooks/useCart';
import { PaymentService } from '@/service/api/payment.service';
import { OrderService } from '@/service/api/order.service';
import { getApiErrorMessage } from '@/service/api/error.utils';

type Status = 'confirming' | 'success' | 'error';

// Página a la que Stripe redirige (return_url) o a la que navegamos tras un pago resuelto en la misma página.
// Confirma el pago de forma idempotente: funciona tanto si el usuario vuelve por una redirección real de
// Stripe (ej. 3D Secure) como si ya se confirmó dentro de /checkout.
export default function CheckoutSuccessClient() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { clearAllCart } = useCart();

    const orderId = searchParams.get('orderId');
    const paymentIntentId = searchParams.get('payment_intent');
    const redirectStatus = searchParams.get('redirect_status');

    const [status, setStatus] = useState<Status>('confirming');
    const [message, setMessage] = useState<string | null>(null);
    const [orderNumber, setOrderNumber] = useState<string | null>(null);

    useEffect(() => {
        let active = true;

        const confirm = async () => {
            if (redirectStatus === 'failed') {
                if (active) {
                    setStatus('error');
                    setMessage('El pago no se pudo completar. Intenta con otro método o vuelve a intentarlo.');
                }
                return;
            }

            if (!orderId || !paymentIntentId) {
                if (active) {
                    setStatus('error');
                    setMessage('Falta información del pago. Si ya se te cobró, revisa tu correo o contáctanos.');
                }
                return;
            }

            try {
                await PaymentService.confirmPayment({ orderId, paymentIntentId });
                if (!active) return;
                clearAllCart();
                setStatus('success');

                if (typeof window !== 'undefined') {
                    if ('caches' in window) {
                        caches.keys().then((keys) => {
                            keys.filter((k) => k.startsWith('sf-api')).forEach((k) => caches.delete(k));
                        }).catch(() => undefined);
                    }
                    if (navigator.serviceWorker?.controller) {
                        navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_API_CACHE' });
                    }
                    window.dispatchEvent(new CustomEvent('inventory-changed'));
                }
                router.refresh();

                // Best-effort: solo para mostrar el número de pedido, no bloquea la confirmación
                OrderService.getOrder(orderId)
                    .then((response) => active && setOrderNumber(response.data.id))
                    .catch(() => undefined);
            } catch (error) {
                if (active) {
                    setStatus('error');
                    setMessage(getApiErrorMessage(error, 'No se pudo confirmar tu pago. Contáctanos si ya se te cobró.'));
                }
            }
        };

        confirm();
        return () => {
            active = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orderId, paymentIntentId, redirectStatus]);

    // Redirección automática a la página principal tras compra exitosa
    const [countdown, setCountdown] = useState<number>(4);

    useEffect(() => {
        if (status !== 'success') return;

        const timer = setInterval(() => {
            setCountdown((prev) => {
                if (prev <= 1) {
                    clearInterval(timer);
                    window.location.href = '/';
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(timer);
    }, [status]);

    if (status === 'confirming') {
        return (
            <section className={styles.section}>
                <div className={styles.container}>
                    <div className={styles.loadingContainer}>
                        <div className={styles.spinner} />
                        <p className={styles.loadingText}>Confirmando tu pago...</p>
                    </div>
                </div>
            </section>
        );
    }

    if (status === 'error') {
        return (
            <section className={styles.section}>
                <div className={styles.container}>
                    <div className={styles.stepContent}>
                        <div className={styles.errorMessage}>{message}</div>
                        <button type="button" className={styles.continueButton} onClick={() => router.push('/checkout')}>
                            Volver al pago
                        </button>
                    </div>
                </div>
            </section>
        );
    }

    return (
        <section className={styles.section}>
            <div className={styles.container}>
                <div className={styles.stepContent}>
                    <div className={styles.success}>
                        <div className={styles.successIcon}>
                            <Check size={56} strokeWidth={3} />
                        </div>
                        <h2>¡Pago realizado con éxito!</h2>
                        {orderNumber && (
                            <p className={styles.orderId}>
                                Tu pedido #<strong>{orderNumber}</strong> ha sido confirmado.
                            </p>
                        )}
                        <p style={{ marginTop: '0.75rem', marginBottom: '1.25rem', color: '#6b7280', fontSize: '0.95rem' }}>
                            Redirigiendo a la tienda en {countdown} segundos...
                        </p>
                        <button
                            type="button"
                            className={styles.continueButton}
                            onClick={() => {
                                window.location.href = '/';
                            }}
                        >
                            Volver a la tienda
                        </button>
                    </div>
                </div>
            </div>
        </section>
    );
}
