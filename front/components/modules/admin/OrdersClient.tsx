'use client';

import React, { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import styles from './admin-table.module.scss';
import { formatMoney, intlLocale } from '@/i18n/config';
import { useAdminOrders } from '@/hooks/useAdminOrders';
import { useAdminBranches } from '@/hooks/useAdminBranches';
import { useAdminRole } from '@/hooks/useAdminAccess';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { OrderStatus } from '@/types/admin.types';

// CANCELADO no se ofrece aquí: cancelar debe pasar por el botón "Cancelar" para que el stock se devuelva
const EDITABLE_STATUSES: OrderStatus[] = ['PENDIENTE', 'PROCESANDO', 'ENVIADO', 'ENTREGADO'];

const formatDate = (value: string, locale: string) =>
    new Date(value).toLocaleDateString(intlLocale(locale), { day: '2-digit', month: 'short', year: 'numeric' });

export default function OrdersClient() {
    const { isGlobal } = useAdminRole();
    const t = useTranslations('AdminOrders');
    const tc = useTranslations('AdminCommon');
    const locale = useLocale();
    const [page, setPage] = useState(1);
    const { orders, total, totalPages, isLoading, error, changeStatus, cancelOrder } = useAdminOrders(page);
    const { branches } = useAdminBranches();
    const [busyId, setBusyId] = useState<string | null>(null);
    const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

    const branchName = (id: string | null) => branches.find((branch) => branch.id === id)?.name ?? '—';

    const runAction = async (orderId: string, action: () => Promise<void>) => {
        setBusyId(orderId);
        setRowErrors((prev) => ({ ...prev, [orderId]: '' }));
        try {
            await action();
        } catch (error) {
            setRowErrors((prev) => ({ ...prev, [orderId]: getApiErrorMessage(error, t('updateFailed')) }));
        } finally {
            setBusyId(null);
        }
    };

    const handleCancel = (orderId: string) => {
        if (window.confirm(t('confirmCancel'))) {
            runAction(orderId, () => cancelOrder(orderId));
        }
    };

    return (
        <div className={styles.page}>
            <div className={styles.pageHeader}>
                <div>
                    <h1>{isGlobal ? t('title') : t('titleBranch')}</h1>
                    <p>
                        {isGlobal ? t('subtitle') : t('subtitleBranch')}{' '}
                        {total > 0 && t('totalCount', { count: total })}
                    </p>
                </div>
            </div>

            {error && <div className={styles.errorMessage}>{error}</div>}

            <div className={styles.tableCard}>
                {isLoading ? (
                    <div className={styles.loadingState}>{t('loading')}</div>
                ) : orders.length === 0 ? (
                    <div className={styles.emptyState}>{t('empty')}</div>
                ) : (
                    <>
                        <div className={styles.tableWrapper}>
                            <table className={styles.table}>
                                <thead>
                                    <tr>
                                        <th>{t('order')}</th>
                                        <th>{t('customer')}</th>
                                        <th>{t('fulfillment')}</th>
                                        <th>{tc('branch')}</th>
                                        <th>{tc('status')}</th>
                                        <th className={styles.numeric}>{tc('total')}</th>
                                        <th className={styles.numeric}>{tc('actions')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {orders.map((order) => {
                                        const isEditable = EDITABLE_STATUSES.includes(order.status);
                                        return (
                                            <tr key={order.id}>
                                                <td>
                                                    <div className={styles.cellMain}>
                                                        <span className={styles.cellTitle}>#{order.id.slice(0, 8)}</span>
                                                        <span className={styles.cellSub}>{formatDate(order.createdAt, locale)}</span>
                                                    </div>
                                                </td>
                                                <td>
                                                    <div className={styles.cellMain}>
                                                        <span className={styles.cellTitle}>{order.userName || tc('noName')}</span>
                                                        <span className={styles.cellSub}>{order.userEmail}</span>
                                                    </div>
                                                </td>
                                                <td>
                                                    <span className={`${styles.badge} ${order.fulfillmentType === 'PICKUP' ? styles.badgeInfo : ''}`}>
                                                        {order.fulfillmentType === 'PICKUP' ? t('pickup') : t('delivery')}
                                                    </span>
                                                    {order.fulfillmentType === 'DELIVERY' && order.shippingAddress && (
                                                        <span className={styles.cellSub}> {order.shippingAddress}</span>
                                                    )}
                                                </td>
                                                <td>{branchName(order.branchId)}</td>
                                                <td>
                                                    {isEditable ? (
                                                        <select
                                                            className={`${styles.input} ${styles.inputSmall}`}
                                                            value={order.status}
                                                            disabled={busyId === order.id}
                                                            onChange={(e) =>
                                                                runAction(order.id, () => changeStatus(order.id, e.target.value as OrderStatus))
                                                            }
                                                            aria-label={t('statusLabel', { id: order.id.slice(0, 8) })}
                                                        >
                                                            {EDITABLE_STATUSES.map((status) => (
                                                                <option key={status} value={status}>{t(`statuses.${status}`)}</option>
                                                            ))}
                                                        </select>
                                                    ) : (
                                                        <span className={`${styles.badge} ${order.status === 'CANCELADO' ? styles.badgeDanger : styles.badgeSuccess}`}>
                                                            {t(`statuses.${order.status}`)}
                                                        </span>
                                                    )}
                                                    {rowErrors[order.id] && <span className={styles.rowError}>{rowErrors[order.id]}</span>}
                                                </td>
                                                <td className={styles.numeric}>
                                                    <div className={styles.cellMain}>
                                                        <span className={styles.cellTitle}>{formatMoney(Number(order.total), locale)}</span>
                                                        {order.discountApplied > 0 && (
                                                            <span className={styles.cellSub}>{t('employeeDiscount', { amount: formatMoney(Number(order.discountApplied), locale) })}</span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td>
                                                    <div className={styles.actions}>
                                                        {order.status === 'PENDIENTE' && (
                                                            <button
                                                                type="button"
                                                                className={styles.buttonDanger}
                                                                disabled={busyId === order.id}
                                                                onClick={() => handleCancel(order.id)}
                                                            >
                                                                {tc('cancel')}
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {totalPages > 1 && (
                            <div className={styles.pagination}>
                                <button
                                    type="button"
                                    className={styles.buttonSecondary}
                                    onClick={() => setPage((p) => p - 1)}
                                    disabled={page === 1}
                                >
                                    {tc('previous')}
                                </button>
                                <span>{tc('pageOf', { page, total: totalPages })}</span>
                                <button
                                    type="button"
                                    className={styles.buttonSecondary}
                                    onClick={() => setPage((p) => p + 1)}
                                    disabled={page >= totalPages}
                                >
                                    {tc('next')}
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
