'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, PackageSearch } from 'lucide-react';
import accountStyles from './account.module.scss';
import styles from './orders.module.scss';
import { useMyOrders } from '@/hooks/useMyOrders';
import { ORDER_STATUS_BADGE_CLASS, ORDER_STATUS_LABELS, OrderStatusValue, formatOrderDate } from './orderStatus';

// "Mis pedidos": historial del cliente, ordenado del más reciente al más antiguo
export default function OrdersTab() {
    const router = useRouter();
    const [page, setPage] = useState(1);
    const { orders, total, totalPages, isLoading, error } = useMyOrders(page);

    return (
        <div className={accountStyles.card}>
            <div className={accountStyles.headingRow}>
                <div>
                    <h1 className={accountStyles.heading}>Mis pedidos</h1>
                    <p className={accountStyles.subheading}>
                        {total > 0 ? `${total} pedido${total === 1 ? '' : 's'} en tu historial.` : 'Aquí verás el estado de tus compras.'}
                    </p>
                </div>
            </div>

            {error && <div className={accountStyles.alertError}>{error}</div>}

            {isLoading ? (
                <p className={accountStyles.subheading}>Cargando pedidos...</p>
            ) : orders.length === 0 ? (
                <div className={accountStyles.empty}>
                    <PackageSearch size={32} strokeWidth={1.5} />
                    <p>Todavía no realizaste ningún pedido.</p>
                </div>
            ) : (
                <>
                    <ul className={styles.orderGrid}>
                        {orders.map((order) => {
                            const status = order.status as OrderStatusValue;
                            const shortId = order.id.slice(0, 8).toUpperCase();
                            return (
                                <li key={order.id}>
                                    <button
                                        type="button"
                                        className={styles.orderCard}
                                        onClick={() => router.push(`/account/orders/${order.id}`)}
                                    >
                                        <div className={styles.orderCardMain}>
                                            <span className={styles.orderCardNumber}>Pedido #{shortId}</span>
                                            <span className={styles.orderCardMeta}>{formatOrderDate(order.createdAt)}</span>
                                        </div>
                                        <div className={styles.orderCardEnd}>
                                            <span className={`${styles.badge} ${styles[ORDER_STATUS_BADGE_CLASS[status]]}`}>
                                                {ORDER_STATUS_LABELS[status] ?? status}
                                            </span>
                                            <span className={styles.orderCardTotal}>${Number(order.total).toFixed(2)}</span>
                                            <ChevronRight size={18} className={styles.chevron} />
                                        </div>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>

                    {totalPages > 1 && (
                        <div className={styles.pagination}>
                            <button
                                type="button"
                                className={accountStyles.secondaryButton}
                                onClick={() => setPage((p) => p - 1)}
                                disabled={page === 1}
                            >
                                Anterior
                            </button>
                            <span>Página {page} de {totalPages}</span>
                            <button
                                type="button"
                                className={accountStyles.secondaryButton}
                                onClick={() => setPage((p) => p + 1)}
                                disabled={page >= totalPages}
                            >
                                Siguiente
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
