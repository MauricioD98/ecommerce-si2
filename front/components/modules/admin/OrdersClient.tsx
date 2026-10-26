'use client';

import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import styles from './admin-table.module.scss';
import { formatMoney, intlLocale } from '@/i18n/config';
import { useAdminOrders } from '@/hooks/useAdminOrders';
import { useAdminBranches } from '@/hooks/useAdminBranches';
import { useAdminRole } from '@/hooks/useAdminAccess';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { AdminOrder, OrderStatus } from '@/types/admin.types';
import { paymentSettingsService } from '@/service/api/paymentSettings.service';

// CANCELADO no se ofrece aquí: cancelar debe pasar por el botón "Cancelar" para que el stock se devuelva
const EDITABLE_STATUSES: OrderStatus[] = ['PENDIENTE', 'PROCESANDO', 'ENVIADO', 'ENTREGADO'];

const PROOF_BADGE = { PENDIENTE: styles.badgeWarning, APROBADO: styles.badgeSuccess, RECHAZADO: styles.badgeDanger } as const;

// Claves de traducción conocidas; un valor nuevo del backend cae en "other" en vez de romper la tabla
const METHOD_KEYS = ['STRIPE', 'CASH', 'PHYSICAL_CARD', 'QR', 'BANK_QR', 'USDT'] as const;
const PAYMENT_KEYS = ['PENDIENTE', 'COMPLETADO', 'FALLIDO', 'REEMBOLSADO'] as const;
const methodKey = (value: string) => ((METHOD_KEYS as readonly string[]).includes(value) ? (value as (typeof METHOD_KEYS)[number]) : 'other');
const paymentKey = (value: string) => ((PAYMENT_KEYS as readonly string[]).includes(value) ? (value as (typeof PAYMENT_KEYS)[number]) : 'other');

const formatDate = (value: string, locale: string) =>
    new Date(value).toLocaleDateString(intlLocale(locale), { day: '2-digit', month: 'short', year: 'numeric' });

export default function OrdersClient() {
    const { isGlobal } = useAdminRole();
    const t = useTranslations('AdminOrders');
    const tc = useTranslations('AdminCommon');
    const locale = useLocale();
    const [page, setPage] = useState(1);
    const { orders, total, totalPages, isLoading, error, changeStatus, cancelOrder, approveProof, rejectProof } = useAdminOrders(page);
    // Pedido cuyo comprobante se está revisando (modal)
    const [reviewing, setReviewing] = useState<AdminOrder | null>(null);
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

    const handleApprove = (orderId: string) => {
        setReviewing(null);
        runAction(orderId, () => approveProof(orderId));
    };

    const handleReject = (orderId: string) => {
        if (!window.confirm(t('proof.confirmReject'))) return;
        setReviewing(null);
        runAction(orderId, () => rejectProof(orderId));
    };

    return (
        <div className={styles.page}>
            {reviewing && (
                <ProofModal
                    order={reviewing}
                    busy={busyId === reviewing.id}
                    onClose={() => setReviewing(null)}
                    onApprove={() => handleApprove(reviewing.id)}
                    onReject={() => handleReject(reviewing.id)}
                />
            )}
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
                                        <th>{t('payment')}</th>
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
                                                <td>
                                                    <div className={styles.cellMain}>
                                                        <span className={styles.cellTitle}>
                                                            {order.paymentMethod ? t(`methods.${methodKey(order.paymentMethod)}`) : '—'}
                                                        </span>
                                                        {order.paymentProof ? (
                                                            <span>
                                                                <span className={`${styles.badge} ${PROOF_BADGE[order.paymentProof.status]}`}>
                                                                    {t(`proof.states.${order.paymentProof.status}`)}
                                                                </span>
                                                            </span>
                                                        ) : (
                                                            order.paymentStatus && (
                                                                <span className={styles.cellSub}>{t(`paymentStatuses.${paymentKey(order.paymentStatus)}`)}</span>
                                                            )
                                                        )}
                                                    </div>
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
                                                        {order.paymentProof?.status === 'PENDIENTE' && order.status === 'PENDIENTE' && (
                                                            <button
                                                                type="button"
                                                                className={styles.button}
                                                                disabled={busyId === order.id}
                                                                onClick={() => setReviewing(order)}
                                                            >
                                                                {t('proof.review')}
                                                            </button>
                                                        )}
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

// Revisión de un pago manual: comprobante (imagen) o TxID, con Aprobar / Rechazar
function ProofModal({
    order,
    busy,
    onClose,
    onApprove,
    onReject,
}: {
    order: AdminOrder;
    busy: boolean;
    onClose: () => void;
    onApprove: () => void;
    onReject: () => void;
}) {
    const t = useTranslations('AdminOrders');
    const tc = useTranslations('AdminCommon');
    const locale = useLocale();
    const proof = order.paymentProof!;
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const [imageError, setImageError] = useState(false);

    useEffect(() => {
        if (!proof.hasImage) return;
        let url: string | null = null;
        let active = true;
        paymentSettingsService
            .proofImageUrl(order.id)
            .then((u) => {
                url = u;
                if (active) setImageUrl(u);
                else URL.revokeObjectURL(u);
            })
            .catch(() => active && setImageError(true));
        return () => {
            active = false;
            if (url) URL.revokeObjectURL(url);
        };
    }, [order.id, proof.hasImage]);

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="proof-title" onClick={(e) => e.stopPropagation()}>
                <div className={styles.modalHeader}>
                    <h2 id="proof-title">{t('proof.title', { id: order.id.slice(0, 8) })}</h2>
                    <button type="button" className={styles.iconButton} onClick={onClose} aria-label={tc('close')}>
                        <X size={20} />
                    </button>
                </div>

                <div className={styles.form}>
                    <div className={styles.cellMain}>
                        <span className={styles.statLabel}>{t('proof.method')}</span>
                        <span className={styles.cellTitle}>{t(`methods.${proof.method}`)}</span>
                    </div>
                    <div className={styles.cellMain}>
                        <span className={styles.statLabel}>{tc('total')}</span>
                        <span className={styles.cellTitle}>{formatMoney(Number(order.total), locale)}</span>
                    </div>
                    <div className={styles.cellMain}>
                        <span className={styles.statLabel}>{t('proof.sentAt')}</span>
                        <span className={styles.cellSub}>{new Date(proof.createdAt).toLocaleString(intlLocale(locale))}</span>
                    </div>
                    {proof.txId && (
                        <div className={styles.cellMain}>
                            <span className={styles.statLabel}>{t('proof.txId')}</span>
                            <code style={{ wordBreak: 'break-all', fontSize: '0.8125rem' }}>{proof.txId}</code>
                        </div>
                    )}
                    {proof.hasImage &&
                        (imageError ? (
                            <div className={styles.errorMessage}>{t('proof.imageFailed')}</div>
                        ) : imageUrl ? (
                            <a href={imageUrl} target="_blank" rel="noopener noreferrer">
                                {/* eslint-disable-next-line @next/next/no-img-element -- object URL local */}
                                <img
                                    src={imageUrl}
                                    alt={t('proof.imageAlt')}
                                    style={{ width: '100%', maxHeight: '55vh', objectFit: 'contain', borderRadius: '0.5rem', border: '1px solid var(--border)' }}
                                />
                            </a>
                        ) : (
                            <div className={styles.loadingState}>{t('loading')}</div>
                        ))}
                    <small className={styles.cellSub}>{proof.method === 'USDT' ? t('proof.usdtHint') : t('proof.qrHint')}</small>

                    <div className={styles.modalFooter}>
                        <button type="button" className={styles.buttonDanger} onClick={onReject} disabled={busy}>
                            {t('proof.reject')}
                        </button>
                        <button type="button" className={styles.button} onClick={onApprove} disabled={busy}>
                            {t('proof.approve')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
