'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { PaymentService, GenerateQrResponse } from '@/service/api/payment.service';
import { getApiErrorMessage } from '@/service/api/error.utils';
import styles from './qr-payment.module.scss';
import { Zap, ExternalLink, RefreshCw } from 'lucide-react';

interface QrPaymentSectionProps {
    orderId?: string;
    amount: number;
    isLoadingOrder?: boolean;
    onSuccess: (paymentIntentId: string) => void;
    onError?: (error: string) => void;
}

export default function QrPaymentSection({
    orderId,
    amount,
    isLoadingOrder = false,
    onSuccess,
    onError,
}: QrPaymentSectionProps) {
    const [qrData, setQrData] = useState<GenerateQrResponse['data'] | null>(null);
    const [isLoadingQr, setIsLoadingQr] = useState<boolean>(false);
    const [isConfirming, setIsConfirming] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const isSuccessHandledRef = useRef<boolean>(false);

    // Generar código QR en cuanto tengamos el orderId
    const loadQr = useCallback(async () => {
        if (!orderId) return;

        setIsLoadingQr(true);
        setError(null);

        try {
            const response = await PaymentService.generateQr(orderId);
            if (response.success && response.data) {
                setQrData(response.data);
            } else {
                throw new Error(response.message || 'No se pudo generar el código QR');
            }
        } catch (err) {
            const msg = getApiErrorMessage(err, 'Error al generar el código QR de pago.');
            setError(msg);
            onError?.(msg);
        } finally {
            setIsLoadingQr(false);
        }
    }, [orderId, onError]);

    useEffect(() => {
        if (orderId && !qrData && !isLoadingQr && !error) {
            loadQr();
        }
    }, [orderId, qrData, isLoadingQr, error, loadQr]);

    // Polling del estado de la orden cada 2.5 segundos para detectar el escaneo desde el celular
    useEffect(() => {
        if (!orderId || isSuccessHandledRef.current) return;

        const checkStatus = async () => {
            try {
                const statusRes = await PaymentService.getQrStatus(orderId);
                if (statusRes.isPaid || statusRes.status === 'COMPLETADO') {
                    if (!isSuccessHandledRef.current) {
                        isSuccessHandledRef.current = true;
                        if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
                        onSuccess(`QR_${orderId}`);
                    }
                }
            } catch {
                // Silencioso durante el polling para evitar parpadeos
            }
        };

        pollingIntervalRef.current = setInterval(checkStatus, 2500);

        return () => {
            if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
            }
        };
    }, [orderId, onSuccess]);

    // Simular el escaneo y confirmación de pago inmediatamente (para presentaciones / pruebas)
    const handleSimulatePayment = async () => {
        if (!orderId || isConfirming) return;

        setIsConfirming(true);
        try {
            await PaymentService.confirmQrPayment(orderId);
            isSuccessHandledRef.current = true;
            if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
            onSuccess(`QR_${orderId}`);
        } catch (err) {
            const msg = getApiErrorMessage(err, 'Error al simular el pago por QR.');
            setError(msg);
            onError?.(msg);
        } finally {
            setIsConfirming(false);
        }
    };

    if (isLoadingOrder || isLoadingQr) {
        return (
            <div className={styles.loadingWrapper}>
                <div className={styles.spinner} />
                <p style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                    {isLoadingOrder ? 'Creando orden de compra...' : 'Generando código QR...'}
                </p>
            </div>
        );
    }

    if (error) {
        return (
            <div className={styles.errorBox}>
                <span>{error}</span>
                <button type="button" onClick={loadQr} className={styles.retryBtn}>
                    <RefreshCw size={14} style={{ display: 'inline', marginRight: 4 }} />
                    Reintentar generar QR
                </button>
            </div>
        );
    }

    if (!qrData) {
        return null;
    }

    return (
        <div className={styles.qrContainer}>
            <h3 className={styles.title}>Escanea el código QR para pagar</h3>
            <p className={styles.subtitle}>
                Abre la cámara de tu teléfono móvil para escanear el código QR o haz clic en simular escaneo para completar el pago.
            </p>

            <div className={styles.qrFrame}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    src={qrData.qrDataUrl}
                    alt="Código QR de Pago Stella Femme"
                    className={styles.qrImage}
                />
            </div>

            <div className={styles.amountBox}>
                <div className={styles.label}>Monto total a pagar</div>
                <div className={styles.value}>Bs {amount.toFixed(2)}</div>
            </div>

            <div className={styles.liveStatus}>
                <div className={styles.pulseDot} />
                <span>Esperando escaneo en tiempo real...</span>
            </div>

            <button
                type="button"
                className={styles.simulateBtn}
                onClick={handleSimulatePayment}
                disabled={isConfirming}
            >
                <Zap size={18} fill="#ffffff" />
                <span>{isConfirming ? 'Confirmando pago...' : 'Simular Escaneo y Pago'}</span>
            </button>

            {qrData.confirmUrl && (
                <a
                    href={qrData.confirmUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.scanLinkBtn}
                >
                    <ExternalLink size={12} style={{ display: 'inline', marginRight: 4 }} />
                    Abrir enlace directo de escaneo
                </a>
            )}
        </div>
    );
}
