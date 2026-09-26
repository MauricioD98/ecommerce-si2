'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import accountStyles from './account.module.scss';
import styles from './orders.module.scss';
import { useOrderDetail } from '@/hooks/useOrderDetail';
import { useBranches } from '@/hooks/useBranches';
import OrderTimeline from './OrderTimeline';
import { ORDER_STATUS_BADGE_CLASS, ORDER_STATUS_LABELS, OrderStatusValue, PAYMENT_STATUS_LABELS, formatOrderDate } from './orderStatus';

interface OrderDetailClientProps {
    orderId: string;
}

// Detalle y seguimiento de un pedido propio: qué se compró (con talla), estado del pago,
// método de entrega/dirección y el timeline de progreso
export default function OrderDetailClient({ orderId }: OrderDetailClientProps) {
    const { order, isLoading, error } = useOrderDetail(orderId);
    const { branches } = useBranches();

    return (
        <section className={accountStyles.page}>
            <div className={styles.orderGrid} style={{ maxWidth: 720, margin: '0 auto' }}>
                <Link href="/account?tab=orders" className={styles.backLink}>
                    <ArrowLeft size={16} />
                    Volver a mis pedidos
                </Link>

                <div className={accountStyles.card}>
                    {isLoading && <p className={accountStyles.subheading}>Cargando pedido...</p>}
                    {error && <div className={accountStyles.alertError}>{error}</div>}

                    {order && (
                        <>
                            <div className={styles.detailHeader}>
                                <div>
                                    <h1 className={styles.detailTitle}>Pedido #{order.id.slice(0, 8).toUpperCase()}</h1>
                                    <p className={styles.detailSubtitle}>Realizado el {formatOrderDate(order.createdAt)}</p>
                                </div>
                                <span
                                    className={`${styles.badge} ${styles[ORDER_STATUS_BADGE_CLASS[order.status as OrderStatusValue]]}`}
                                >
                                    {ORDER_STATUS_LABELS[order.status as OrderStatusValue] ?? order.status}
                                </span>
                            </div>

                            <OrderTimeline status={order.status as OrderStatusValue} />

                            <div className={styles.infoGrid}>
                                <div className={styles.infoBlock}>
                                    <span className={styles.infoLabel}>Método de entrega</span>
                                    <span className={styles.infoValue}>
                                        {order.fulfillmentType === 'PICKUP'
                                            ? `Retiro en sucursal${order.branchId ? `: ${branches.find((b) => b.id === order.branchId)?.name ?? ''}` : ''}`
                                            : 'Envío a domicilio'}
                                    </span>
                                </div>
                                <div className={styles.infoBlock}>
                                    <span className={styles.infoLabel}>
                                        {order.fulfillmentType === 'PICKUP' ? 'Sucursal' : 'Dirección de envío'}
                                    </span>
                                    <span className={styles.infoValue}>
                                        {order.fulfillmentType === 'PICKUP'
                                            ? branches.find((b) => b.id === order.branchId)?.address ?? '—'
                                            : order.shippingAddress || '—'}
                                    </span>
                                </div>
                                <div className={styles.infoBlock}>
                                    <span className={styles.infoLabel}>Estado del pago</span>
                                    <span className={styles.infoValue}>
                                        {PAYMENT_STATUS_LABELS[order.paymentStatus] ?? order.paymentStatus}
                                    </span>
                                </div>
                            </div>

                            <h2 className={accountStyles.heading} style={{ fontSize: '1.0625rem', marginBottom: '0.75rem' }}>
                                Artículos
                            </h2>
                            <ul className={styles.itemsList}>
                                {order.items.map((item) => (
                                    <li key={item.id} className={styles.itemRow}>
                                        <div className={styles.itemInfo}>
                                            <span className={styles.itemName}>{item.productName}</span>
                                            <span className={styles.itemMeta}>
                                                {item.size ? `Talla: ${item.size} · ` : ''}Cantidad: {item.quantity}
                                            </span>
                                        </div>
                                        <span className={styles.itemSubtotal}>Bs {item.subtotal.toFixed(2)}</span>
                                    </li>
                                ))}
                            </ul>

                            <div className={styles.totalsBlock}>
                                {order.discountApplied > 0 && (
                                    <div className={styles.totalsRow}>
                                        <span>Descuento de empleado</span>
                                        <span>-Bs {Number(order.discountApplied).toFixed(2)}</span>
                                    </div>
                                )}
                                {order.fulfillmentType === 'DELIVERY' && (
                                    <div className={styles.totalsRow}>
                                        <span>Costo de envío</span>
                                        <span>Bs {Number(order.shippingCost).toFixed(2)}</span>
                                    </div>
                                )}
                                <div className={styles.totalsRowFinal}>
                                    <span>Total</span>
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
