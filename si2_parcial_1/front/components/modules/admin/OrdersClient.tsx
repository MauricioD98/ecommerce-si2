'use client';

import React, { useState } from 'react';
import styles from './admin-table.module.scss';
import { useAdminOrders } from '@/hooks/useAdminOrders';
import { useAdminBranches } from '@/hooks/useAdminBranches';
import { useAdminRole } from '@/hooks/useAdminAccess';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { OrderStatus } from '@/types/admin.types';

const STATUS_LABELS: Record<OrderStatus, string> = {
    PENDIENTE: 'Pendiente',
    PROCESANDO: 'Procesando',
    ENVIADO: 'Enviado',
    ENTREGADO: 'Entregado',
    CANCELADO: 'Cancelado',
};

// CANCELADO no se ofrece aquí: cancelar debe pasar por el botón "Cancelar" para que el stock se devuelva
const EDITABLE_STATUSES: OrderStatus[] = ['PENDIENTE', 'PROCESANDO', 'ENVIADO', 'ENTREGADO'];

const formatDate = (value: string) =>
    new Date(value).toLocaleDateString('es-BO', { day: '2-digit', month: 'short', year: 'numeric' });

export default function OrdersClient() {
    const { isGlobal } = useAdminRole();
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
            setRowErrors((prev) => ({ ...prev, [orderId]: getApiErrorMessage(error, 'No se pudo actualizar el pedido.') }));
        } finally {
            setBusyId(null);
        }
    };

    const handleCancel = (orderId: string) => {
        if (window.confirm('¿Cancelar este pedido? El stock volverá a la sucursal.')) {
            runAction(orderId, () => cancelOrder(orderId));
        }
    };

    return (
        <div className={styles.page}>
            <div className={styles.pageHeader}>
                <div>
                    <h1>{isGlobal ? 'Pedidos' : 'Pedidos Locales'}</h1>
                    <p>
                        {isGlobal
                            ? 'Todos los pedidos de todas las sucursales.'
                            : 'Pedidos de tu sucursal.'}{' '}
                        {total > 0 && `${total} en total.`}
                    </p>
                </div>
            </div>

            {error && <div className={styles.errorMessage}>{error}</div>}

            <div className={styles.tableCard}>
                {isLoading ? (
                    <div className={styles.loadingState}>Cargando pedidos...</div>
                ) : orders.length === 0 ? (
                    <div className={styles.emptyState}>Aún no hay pedidos.</div>
                ) : (
                    <>
                        <div className={styles.tableWrapper}>
                            <table className={styles.table}>
                                <thead>
                                    <tr>
                                        <th>Pedido</th>
                                        <th>Cliente</th>
                                        <th>Entrega</th>
                                        <th>Sucursal</th>
                                        <th>Estado</th>
                                        <th className={styles.numeric}>Total</th>
                                        <th className={styles.numeric}>Acciones</th>
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
                                                        <span className={styles.cellSub}>{formatDate(order.createdAt)}</span>
                                                    </div>
                                                </td>
                                                <td>
                                                    <div className={styles.cellMain}>
                                                        <span className={styles.cellTitle}>{order.userName || 'Sin nombre'}</span>
                                                        <span className={styles.cellSub}>{order.userEmail}</span>
                                                    </div>
                                                </td>
                                                <td>
                                                    <span className={`${styles.badge} ${order.fulfillmentType === 'PICKUP' ? styles.badgeInfo : ''}`}>
                                                        {order.fulfillmentType === 'PICKUP' ? 'Retiro en tienda' : 'Envío a domicilio'}
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
                                                            aria-label={`Estado del pedido ${order.id.slice(0, 8)}`}
                                                        >
                                                            {EDITABLE_STATUSES.map((status) => (
                                                                <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                                                            ))}
                                                        </select>
                                                    ) : (
                                                        <span className={`${styles.badge} ${order.status === 'CANCELADO' ? styles.badgeDanger : styles.badgeSuccess}`}>
                                                            {STATUS_LABELS[order.status]}
                                                        </span>
                                                    )}
                                                    {rowErrors[order.id] && <span className={styles.rowError}>{rowErrors[order.id]}</span>}
                                                </td>
                                                <td className={styles.numeric}>
                                                    <div className={styles.cellMain}>
                                                        <span className={styles.cellTitle}>${Number(order.total).toFixed(2)}</span>
                                                        {order.discountApplied > 0 && (
                                                            <span className={styles.cellSub}>Desc. empleado -${Number(order.discountApplied).toFixed(2)}</span>
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
                                                                Cancelar
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
                                    Anterior
                                </button>
                                <span>Página {page} de {totalPages}</span>
                                <button
                                    type="button"
                                    className={styles.buttonSecondary}
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
        </div>
    );
}
