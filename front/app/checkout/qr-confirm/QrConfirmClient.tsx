'use client';

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PaymentService } from '@/service/api/payment.service';
import { CheckCircle2, AlertCircle, ShoppingBag } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useStoreName } from '@/providers/StoreInfoProvider';

export default function QrConfirmClient() {
    const searchParams = useSearchParams();
    const orderId = searchParams.get('orderId');
    const t = useTranslations('Checkout.qrConfirm');
    const storeName = useStoreName();

    const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
    const [orderInfo, setOrderInfo] = useState<{ orderNumber?: string; totalAmount?: number } | null>(null);
    const [errorMsg, setErrorMsg] = useState<string>('');

    useEffect(() => {
        if (!orderId) {
            setStatus('error');
            setErrorMsg(t('missingOrder'));
            return;
        }

        const confirm = async () => {
            try {
                const res = await PaymentService.confirmQrPayment(orderId);
                if (res.success) {
                    setStatus('success');
                    setOrderInfo(res.data);
                } else {
                    setStatus('error');
                    setErrorMsg(res.message || t('confirmFailed'));
                }
            } catch (err: any) {
                // Si ya estaba confirmado, obtenemos el estado
                try {
                    const statusRes = await PaymentService.getQrStatus(orderId);
                    if (statusRes.isPaid) {
                        setStatus('success');
                        setOrderInfo({
                            orderNumber: statusRes.orderNumber?.toString(),
                            totalAmount: statusRes.totalAmount,
                        });
                        return;
                    }
                } catch {
                    // Ignorar
                }
                setStatus('error');
                setErrorMsg(err?.response?.data?.message || err.message || t('processFailed'));
            }
        };

        confirm();
    }, [orderId]);

    return (
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#0f172a',
            color: '#f8fafc',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            padding: '20px',
            boxSizing: 'border-box',
        }}>
            <div style={{
                backgroundColor: '#1e293b',
                borderRadius: '24px',
                padding: '36px 24px',
                maxWidth: '420px',
                width: '100%',
                textAlign: 'center',
                border: '1px solid #334155',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            }}>
                {status === 'loading' && (
                    <div>
                        <div style={{
                            width: '48px',
                            height: '48px',
                            border: '3px solid #334155',
                            borderTopColor: '#38bdf8',
                            borderRadius: '50%',
                            margin: '0 auto 20px',
                            animation: 'spin 1s linear infinite',
                        }} />
                        <h2 style={{ fontSize: '18px', color: '#f8fafc', margin: '0 0 8px' }}>
                            {t('processing')}
                        </h2>
                        <p style={{ fontSize: '14px', color: '#94a3b8', margin: 0 }}>
                            {t('connecting')}
                        </p>
                    </div>
                )}

                {status === 'success' && (
                    <div>
                        <div style={{
                            width: '72px',
                            height: '72px',
                            backgroundColor: '#065f46',
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            margin: '0 auto 16px',
                            color: '#34d399',
                        }}>
                            <CheckCircle2 size={44} strokeWidth={2.5} />
                        </div>

                        <h1 style={{ fontSize: '22px', color: '#f8fafc', margin: '0 0 6px', fontWeight: 700 }}>
                            {t('title')}
                        </h1>

                        <div style={{
                            display: 'inline-block',
                            backgroundColor: 'rgba(52, 211, 153, 0.15)',
                            color: '#34d399',
                            border: '1px solid #059669',
                            fontWeight: 600,
                            padding: '4px 12px',
                            borderRadius: '999px',
                            fontSize: '12px',
                            marginBottom: '16px',
                        }}>
                            {t('verified', { store: storeName })}
                        </div>

                        <p style={{ fontSize: '14px', color: '#94a3b8', lineHeight: 1.5, margin: '0 0 20px' }}>
                            {t('description')}
                        </p>

                        <div style={{
                            backgroundColor: '#0f172a',
                            border: '1px solid #334155',
                            borderRadius: '14px',
                            padding: '16px',
                            marginBottom: '24px',
                            textAlign: 'left',
                        }}>
                            {orderInfo?.orderNumber && (
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px', color: '#94a3b8' }}>
                                    <span>{t('orderNumber')}</span>
                                    <span style={{ color: '#f8fafc', fontWeight: 600 }}>#{orderInfo.orderNumber}</span>
                                </div>
                            )}
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px', color: '#94a3b8' }}>
                                <span>{t('method')}</span>
                                <span style={{ color: '#f8fafc', fontWeight: 600 }}>{t('methodValue')}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px', color: '#94a3b8' }}>
                                <span>{t('status')}</span>
                                <span style={{ color: '#34d399', fontWeight: 700 }}>{t('statusValue')}</span>
                            </div>
                            {orderInfo?.totalAmount && (
                                <div style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    fontWeight: 'bold',
                                    color: '#f8fafc',
                                    fontSize: '16px',
                                    paddingTop: '8px',
                                    borderTop: '1px solid #1e293b',
                                }}>
                                    <span>{t('total')}</span>
                                    <span style={{ color: '#38bdf8' }}>Bs {Number(orderInfo.totalAmount).toFixed(2)}</span>
                                </div>
                            )}
                        </div>

                        <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 20px' }}>
                            {t('autoUpdate')}
                        </p>

                        <Link
                            href="/"
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px',
                                width: '100%',
                                padding: '12px',
                                backgroundColor: '#059669',
                                color: '#ffffff',
                                borderRadius: '10px',
                                fontWeight: 600,
                                textDecoration: 'none',
                                fontSize: '14px',
                                boxSizing: 'border-box',
                            }}
                        >
                            <ShoppingBag size={16} />
                            <span>{t('goToStore')}</span>
                        </Link>
                    </div>
                )}

                {status === 'error' && (
                    <div>
                        <div style={{
                            width: '64px',
                            height: '64px',
                            backgroundColor: '#7f1d1d',
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            margin: '0 auto 16px',
                            color: '#f87171',
                        }}>
                            <AlertCircle size={40} />
                        </div>
                        <h2 style={{ fontSize: '18px', color: '#f8fafc', margin: '0 0 8px' }}>
                            {t('errorTitle')}
                        </h2>
                        <p style={{ fontSize: '14px', color: '#94a3b8', margin: '0 0 20px' }}>
                            {errorMsg}
                        </p>
                        <Link
                            href="/"
                            style={{
                                display: 'inline-block',
                                padding: '10px 20px',
                                backgroundColor: '#334155',
                                color: '#ffffff',
                                borderRadius: '8px',
                                textDecoration: 'none',
                                fontSize: '14px',
                            }}
                        >
                            {t('backHome')}
                        </Link>
                    </div>
                )}
            </div>
            <style jsx global>{`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
}
