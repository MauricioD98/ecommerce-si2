'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import accountStyles from './account.module.scss';
import styles from './orders.module.scss';
import { useOrderDetail } from '@/hooks/useOrderDetail';
import { useBranches } from '@/hooks/useBranches';
import OrderTimeline from './OrderTimeline';
import ManualPaymentSection from '../checkout/ManualPaymentSection';
import { ManualPaymentMethod, PaymentOptions, paymentSettingsService } from '@/service/api/paymentSettings.service';
import { ORDER_STATUS_BADGE_CLASS, OrderStatusValue, formatOrderDate, isOrderStatus, isPaymentStatus } from './orderStatus';

interface OrderDetailClientProps {
    orderId: string;
}

// Detalle y seguimiento de un pedido propio: qué se compró (con talla), estado del pago,
// método de entrega/dirección y el timeline de progreso
export default function OrderDetailClient({ orderId }: OrderDetailClientProps) {
    const { order, isLoading, error, reload } = useOrderDetail(orderId);
    const { branches } = useBranches();
    const t = useTranslations('Account');
    const locale = useLocale();

    // Pedido con QR bancario / USDT que todavía no tiene comprobante (p. ej. se cerró el checkout antes
    // de enviarlo): se puede enviar desde acá
    const awaitingProof = Boolean(
        order &&
            (order.paymentMethod === 'BANK_QR' || order.paymentMethod === 'USDT') &&
            order.status === 'PENDIENTE' &&
            order.paymentStatus === 'PENDIENTE' &&
            !order.paymentProof,
    );
    const [paymentOptions, setPaymentOptions] = useState<PaymentOptions | null>(null);
    useEffect(() => {
        if (awaitingProof) paymentSettingsService.getOptions().then(setPaymentOptions).catch(() => undefined);
    }, [awaitingProof]);
    const manualMethod = order?.paymentMethod as ManualPaymentMethod | undefined;
    const methodAvailable =
        manualMethod === 'BANK_QR' ? Boolean(paymentOptions?.bankQr) : manualMethod === 'USDT' ? Boolean(paymentOptions?.usdt) : false;

    return (
        <section className={accountStyles.page}>
            <div className={styles.orderGrid} style={{ maxWidth: 720, margin: '0 auto' }}>
                <Link href="/account?tab=orders" className={styles.backLink}>
                    <ArrowLeft size={16} />
                    {t('orders.back')}
                </Link>

                <div className={accountStyles.card}>
                    {isLoading && <p className={accountStyles.subheading}>{t('orders.loadingOne')}</p>}
                    {error && <div className={accountStyles.alertError}>{error}</div>}

                    {order && (
                        <>
                            <div className={styles.detailHeader}>
                                <div>
                                    <h1 className={styles.detailTitle}>{t('orders.number', { id: order.id.slice(0, 8).toUpperCase() })}</h1>
                                    <p className={styles.detailSubtitle}>{t('orders.placedOn', { date: formatOrderDate(order.createdAt, locale) })}</p>
                                </div>
                                <span
                                    className={`${styles.badge} ${styles[ORDER_STATUS_BADGE_CLASS[order.status as OrderStatusValue]]}`}
                                >
                                    {isOrderStatus(order.status) ? t(`status.${order.status}`) : order.status}
                                </span>
                            </div>

                            <OrderTimeline status={order.status as OrderStatusValue} />

                            <div className={styles.infoGrid}>
                                <div className={styles.infoBlock}>
                                    <span className={styles.infoLabel}>{t('orders.fulfillment')}</span>
                                    <span className={styles.infoValue}>
                                        {order.fulfillmentType === 'PICKUP'
                                            ? order.branchId
                                                ? t('orders.pickupAt', { branch: branches.find((b) => b.id === order.branchId)?.name ?? '' })
                                                : t('orders.pickup')
                                            : t('orders.delivery')}
                                    </span>
                                </div>
                                <div className={styles.infoBlock}>
                                    <span className={styles.infoLabel}>
                                        {order.fulfillmentType === 'PICKUP' ? t('orders.branch') : t('orders.shippingAddress')}
                                    </span>
                                    <span className={styles.infoValue}>
                                        {order.fulfillmentType === 'PICKUP'
                                            ? branches.find((b) => b.id === order.branchId)?.address ?? '—'
                                            : order.shippingAddress || '—'}
                                    </span>
                                </div>
                                <div className={styles.infoBlock}>
                                    <span className={styles.infoLabel}>{t('orders.paymentStatus')}</span>
                                    <span className={styles.infoValue}>
                                        {isPaymentStatus(order.paymentStatus) ? t(`payment.${order.paymentStatus}`) : order.paymentStatus}
                                    </span>
                                </div>
                                {order.paymentProof && (
                                    <div className={styles.infoBlock}>
                                        <span className={styles.infoLabel}>{t('orders.proofLabel')}</span>
                                        <span className={styles.infoValue}>{t(`orders.proofStates.${order.paymentProof.status}`)}</span>
                                    </div>
                                )}
                            </div>

                            {awaitingProof && paymentOptions && manualMethod && methodAvailable && (
                                <div style={{ marginBottom: '1.5rem' }}>
                                    <ManualPaymentSection
                                        method={manualMethod}
                                        options={paymentOptions}
                                        amount={Number(order.total)}
                                        ensureOrder={async () => order.id}
                                        onSubmitted={reload}
                                    />
                                </div>
                            )}

                            <h2 className={accountStyles.heading} style={{ fontSize: '1.0625rem', marginBottom: '0.75rem' }}>
                                {t('orders.items')}
                            </h2>
                            <ul className={styles.itemsList}>
                                {order.items.map((item) => (
                                    <li key={item.id} className={styles.itemRow}>
                                        <div className={styles.itemInfo}>
                                            <span className={styles.itemName}>{item.productName}</span>
                                            <span className={styles.itemMeta}>
                                                {item.size ? t('orders.itemSize', { size: item.size }) : ''}{t('orders.itemQuantity', { quantity: item.quantity })}
                                            </span>
                                        </div>
                                        <span className={styles.itemSubtotal}>Bs {item.subtotal.toFixed(2)}</span>
                                    </li>
                                ))}
                            </ul>

                            <div className={styles.totalsBlock}>
                                {order.discountApplied > 0 && (
                                    <div className={styles.totalsRow}>
                                        <span>{t('orders.employeeDiscount')}</span>
                                        <span>-Bs {Number(order.discountApplied).toFixed(2)}</span>
                                    </div>
                                )}
                                {order.fulfillmentType === 'DELIVERY' && (
                                    <div className={styles.totalsRow}>
                                        <span>{t('orders.shippingCost')}</span>
                                        <span>Bs {Number(order.shippingCost).toFixed(2)}</span>
                                    </div>
                                )}
                                <div className={styles.totalsRowFinal}>
                                    <span>{t('orders.total')}</span>
                                    <span>Bs {Number(order.total).toFixed(2)}</span>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </section>
    );
}
