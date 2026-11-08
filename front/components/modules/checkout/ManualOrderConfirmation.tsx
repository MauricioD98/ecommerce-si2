'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import styles from './manual-confirmation.module.scss';
import { formatMoney } from '@/i18n/config';
import { OrderService } from '@/service/api/order.service';
import { Order } from '@/types/orders.types';

interface ManualOrderConfirmationProps {
    orderId: string;
    // Al salir de la confirmación (ver pedido o volver a la tienda)
    onLeave?: () => void;
}

type Load = { kind: 'loading' } | { kind: 'ready'; order: Order } | { kind: 'error' };

// Paso 3 de un pago manual (QR bancario, USDT, billetera). Todo lo que muestra sale de GET /orders/:id:
// productos, tallas, cantidades, total y estado del pago tal como los tiene el servidor. Nunca del carrito,
// que ya se vació. El pago se muestra como confirmado solo si el servidor dice COMPLETADO.
export default function ManualOrderConfirmation({ orderId, onLeave }: ManualOrderConfirmationProps) {
    const t = useTranslations('Checkout.confirmation');
    const locale = useLocale();
    const [state, setState] = useState<Load>({ kind: 'loading' });

    const load = useCallback(async () => {
        try {
            const response = await OrderService.getOrder(orderId);
            const order = (response.data ?? response) as Order;
            if (!order?.id || !Array.isArray(order.items)) throw new Error('invalid order');
            setState({ kind: 'ready', order });
        } catch {
            setState({ kind: 'error' });
        }
    }, [orderId]);

    useEffect(() => {
        let active = true;
        OrderService.getOrder(orderId)
            .then((response) => {
                const order = (response.data ?? response) as Order;
                if (!active) return;
                if (!order?.id || !Array.isArray(order.items)) setState({ kind: 'error' });
                else setState({ kind: 'ready', order });
            })
            .catch(() => active && setState({ kind: 'error' }));
        return () => {
            active = false;
        };
    }, [orderId]);

    const order = state.kind === 'ready' ? state.order : null;
    const paid = order?.paymentStatus === 'COMPLETADO';
    const rejected = order?.paymentProof?.status === 'RECHAZADO' || order?.status === 'CANCELADO';
    const orderLabel = order?.orderNumber ?? orderId.slice(0, 8);

    return (
        <div className={styles.wrapper}>
            <div className={styles.hero} role="status">
                <div className={`${styles.icon} ${paid ? styles.iconPaid : rejected ? styles.iconRejected : styles.iconPending}`}>
                    {paid ? <CheckCircle2 size={44} /> : rejected ? <XCircle size={44} /> : <Clock size={44} />}
                </div>
                <h2>{paid ? t('paidTitle') : rejected ? t('rejectedTitle') : t('title')}</h2>
                <p className={styles.lead}>{paid ? t('paidText') : rejected ? t('rejectedText') : t('text')}</p>
                {order && (
                    <p className={styles.orderNumber}>
                        {t.rich('orderNumber', { order: orderLabel, strong: (chunks) => <strong>{chunks}</strong> })}
                    </p>
                )}
            </div>

            {state.kind === 'loading' && <p className={styles.muted}>{t('loading')}</p>}

            {state.kind === 'error' && (
                <div className={styles.errorBox} role="alert">
                    <p>{t('loadFailed')}</p>
                    <button type="button" className={styles.secondaryButton} onClick={() => { setState({ kind: 'loading' }); load(); }}>
                        {t('retry')}
                    </button>
                </div>
            )}

            {order && (
                <section className={styles.summary} aria-label={t('summaryTitle')}>
                    <h3>{t('summaryTitle')}</h3>
                    <ul className={styles.items}>
                        {order.items.map((item) => (
                            <li key={item.id} className={styles.item}>
                                <span className={styles.itemName}>
                                    {item.productName}
                                    <span className={styles.itemMeta}>
                                        {item.size ? `${t('size', { size: item.size })} · ` : ''}
                                        {t('quantity', { count: item.quantity })}
                                    </span>
                                </span>
                                <span className={styles.itemPrice}>{formatMoney(item.subtotal, locale)}</span>
                            </li>
                        ))}
                    </ul>
                    {order.discountApplied > 0 && (
                        <div className={styles.row}>
                            <span>{t('discount')}</span>
                            <span>-{formatMoney(order.discountApplied, locale)}</span>
                        </div>
                    )}
                    {order.fulfillmentType === 'DELIVERY' && (
                        <div className={styles.row}>
                            <span>{t('shipping')}</span>
                            <span>{formatMoney(order.shippingCost, locale)}</span>
                        </div>
                    )}
                    <div className={styles.total}>
                        <span>{t('total')}</span>
                        <span>{formatMoney(order.total, locale)}</span>
                    </div>
                    <div className={styles.row}>
                        <span>{t('paymentStatus')}</span>
                        <span className={paid ? styles.statusPaid : rejected ? styles.statusRejected : styles.statusPending}>
                            {paid ? t('statusPaid') : rejected ? t('statusRejected') : t('statusPending')}
                        </span>
                    </div>
                </section>
            )}

            <div className={styles.actions}>
                <Link href={`/account/orders/${orderId}`} className={styles.primaryButton} onClick={onLeave}>
                    {t('viewOrder')}
                </Link>
                <Link href="/" className={styles.secondaryButton} onClick={onLeave}>
                    {t('backToStore')}
                </Link>
            </div>
        </div>
    );
}
