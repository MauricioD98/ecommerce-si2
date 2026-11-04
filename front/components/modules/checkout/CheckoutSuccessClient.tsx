'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, Clock } from 'lucide-react';
import axios from 'axios';
import { forgetAttemptsOfOrder } from '@/utils/checkoutAttempts';
import { useAuth } from '@/hooks/useAuth';
import { useTranslations } from 'next-intl';
import styles from './checkout.module.scss';
import { useCart } from '@/hooks/useCart';
import { PaymentService } from '@/service/api/payment.service';
import { OrderService } from '@/service/api/order.service';
import { getApiErrorMessage } from '@/service/api/error.utils';

type Status = 'confirming' | 'pending' | 'success' | 'error';

const PENDING_POLL_MS = 8000;

// Página a la que Stripe redirige (return_url) o a la que navegamos tras un pago resuelto en la misma página.
// Confirma el pago de forma idempotente: funciona tanto si el usuario vuelve por una redirección real de
// Stripe (ej. 3D Secure) como si ya se confirmó dentro de /checkout.
export default function CheckoutSuccessClient() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { clearAllCart } = useCart();
    const { user } = useAuth();
    const t = useTranslations('Checkout.success');

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
                    setMessage(t('failed'));
                }
                return;
            }

            if (!orderId || !paymentIntentId) {
                if (active) {
                    setStatus('error');
                    setMessage(t('missingInfo'));
                }
                return;
            }

            try {
                await PaymentService.confirmPayment({ orderId, paymentIntentId });
                if (!active) return;
                clearAllCart();
                forgetAttemptsOfOrder(user?.id ?? null, orderId).catch(() => undefined);
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
                if (!active) return;
                // processing / 3DS: el servidor todavía no tiene evidencia del pago. No se muestra compra
                // pagada ni se vacía el carrito; se vuelve a consultar. Sin respuesta tampoco es un fracaso.
                const pending =
                    axios.isAxiosError(error) && (!error.response || error.response.status >= 500 || error.response.data?.code === 'PAYMENT_PENDING');
                if (pending) {
                    setStatus('pending');
                    pollTimer = setTimeout(confirm, PENDING_POLL_MS);
                    return;
                }
                setStatus('error');
                setMessage(getApiErrorMessage(error, t('confirmFailed')));
            }
        };

        let pollTimer: ReturnType<typeof setTimeout> | undefined;
        confirm();
        return () => {
            active = false;
            if (pollTimer) clearTimeout(pollTimer);
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
                        <p className={styles.loadingText}>{t('confirming')}</p>
                    </div>
                </div>
            </section>
        );
    }

    if (status === 'pending') {
        return (
            <section className={styles.section}>
                <div className={styles.container}>
                    <div className={styles.stepContent}>
                        <div className={styles.success} role="status">
                            <div className={styles.successIcon}>
                                <Clock size={56} strokeWidth={2.5} />
                            </div>
                            <h2>{t('pendingTitle')}</h2>
                            <p className={styles.orderId}>{t('pendingDescription')}</p>
                        </div>
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
                            {t('backToPayment')}
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
                        <h2>{t('title')}</h2>
                        {orderNumber && (
                            <p className={styles.orderId}>
                                {t.rich('orderConfirmed', { order: orderNumber, strong: (chunks) => <strong>{chunks}</strong> })}
                            </p>
                        )}
                        <p style={{ marginTop: '0.75rem', marginBottom: '1.25rem', color: '#6b7280', fontSize: '0.95rem' }}>
                            {t('redirecting', { seconds: countdown })}
                        </p>
                        <button
                            type="button"
                            className={styles.continueButton}
                            onClick={() => {
                                window.location.href = '/';
                            }}
                        >
                            {t('backToStore')}
                        </button>
                    </div>
                </div>
            </div>
        </section>
    );
}
