'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, PackageSearch } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import accountStyles from './account.module.scss';
import styles from './orders.module.scss';
import { useMyOrders } from '@/hooks/useMyOrders';
import { ORDER_STATUS_BADGE_CLASS, OrderStatusValue, formatOrderDate, isOrderStatus } from './orderStatus';

// "Mis pedidos": historial del cliente, ordenado del más reciente al más antiguo
export default function OrdersTab() {
    const router = useRouter();
    const [page, setPage] = useState(1);
    const t = useTranslations('Account');
    const tPages = useTranslations('Store');
    const locale = useLocale();
    const { orders, total, totalPages, isLoading, error } = useMyOrders(page);

    return (
        <div className={accountStyles.card}>
            <div className={accountStyles.headingRow}>
                <div>
                    <h1 className={accountStyles.heading}>{t('orders.title')}</h1>
                    <p className={accountStyles.subheading}>
                        {total > 0 ? t('orders.count', { count: total }) : t('orders.emptySubtitle')}
                    </p>
                </div>
            </div>

            {error && <div className={accountStyles.alertError}>{error}</div>}

            {isLoading ? (
                <p className={accountStyles.subheading}>{t('orders.loading')}</p>
            ) : orders.length === 0 ? (
                <div className={accountStyles.empty}>
                    <PackageSearch size={32} strokeWidth={1.5} />
                    <p>{t('orders.empty')}</p>
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
                                            <span className={styles.orderCardNumber}>{t('orders.number', { id: shortId })}</span>
                                            <span className={styles.orderCardMeta}>{formatOrderDate(order.createdAt, locale)}</span>
                                        </div>
                                        <div className={styles.orderCardEnd}>
                                            <span className={`${styles.badge} ${styles[ORDER_STATUS_BADGE_CLASS[status]]}`}>
                                                {isOrderStatus(status) ? t(`status.${status}`) : status}
                                            </span>
                                            <span className={styles.orderCardTotal}>Bs {Number(order.total).toFixed(2)}</span>
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
                                {tPages('previous')}
                            </button>
                            <span>{tPages('pageOf', { page, total: totalPages })}</span>
                            <button
                                type="button"
                                className={accountStyles.secondaryButton}
                                onClick={() => setPage((p) => p + 1)}
                                disabled={page >= totalPages}
                            >
                                {tPages('next')}
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
