'use client';

import React, { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import styles from './admin-table.module.scss';
import { useSalesReport } from '@/hooks/useReports';
import { useAdminBranches } from '@/hooks/useAdminBranches';
import { useAdminRole } from '@/hooks/useAdminAccess';

const RANGES = [
    { days: 7, label: 'Últimos 7 días' },
    { days: 30, label: 'Últimos 30 días' },
    { days: 90, label: 'Últimos 90 días' },
];

const money = (value: number) => `Bs ${value.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function GeneralMetrics() {
    const { isGlobal } = useAdminRole();
    const { branches } = useAdminBranches();
    // '' = todas las sucursales; sin alcance global el backend usa siempre la propia
    const [branchId, setBranchId] = useState('');
    const [days, setDays] = useState(30);
    const { overview, topProducts, error, isLoading } = useSalesReport(isGlobal ? branchId : '', days);

    const cards = overview
        ? [
              { label: 'Ingresos', value: money(overview.totalRevenue), hint: `${overview.paidOrders} pedidos pagados` },
              { label: 'Pedidos', value: String(overview.totalOrders), hint: `${overview.completedOrders} entregados` },
              { label: 'Ticket promedio', value: money(overview.averageOrderValue), hint: 'Por pedido pagado' },
              { label: 'Pendientes', value: String(overview.pendingOrders), hint: `${overview.cancelledOrders} cancelados` },
              { label: 'Descuentos de empleado', value: money(overview.totalDiscounts), hint: 'En pedidos pagados' },
          ]
        : [];

    return (
        <div className={styles.page}>
            <div className={styles.toolbar}>
                {isGlobal && (
                    <select className={styles.input} value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label="Sucursal">
                        <option value="">Todas las sucursales</option>
                        {branches.map((branch) => (
                            <option key={branch.id} value={branch.id}>{branch.name}</option>
                        ))}
                    </select>
                )}
                <select className={styles.input} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Rango de fechas">
                    {RANGES.map((range) => (
                        <option key={range.days} value={range.days}>{range.label}</option>
                    ))}
                </select>
            </div>

            {error && <div className={styles.errorMessage}>{error}</div>}

            {isLoading && !overview ? (
                <div className={styles.tableCard}><div className={styles.loadingState}>Cargando métricas...</div></div>
            ) : overview && (
                <>
                    <div className={styles.statGrid}>
                        {cards.map((card) => (
                            <div key={card.label} className={styles.statCard}>
                                <span className={styles.statLabel}>{card.label}</span>
                                <span className={styles.statValue}>{card.value}</span>
                                <span className={styles.cellSub}>{card.hint}</span>
                            </div>
                        ))}
                    </div>

                    <div className={`${styles.tableCard} ${styles.chartCard}`}>
                        <h2 className={styles.sectionTitle}>Ingresos por día</h2>
                        <div className={styles.chart}>
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={overview.salesByDay} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                                    <XAxis dataKey="date" tickFormatter={(date: string) => date.slice(5)} tick={{ fontSize: 12 }} minTickGap={16} />
                                    <YAxis tick={{ fontSize: 12 }} width={56} tickFormatter={(value: number) => `Bs ${value}`} />
                                    <Tooltip
                                        formatter={(value) => [money(Number(value)), 'Ingresos']}
                                        labelFormatter={(label) => `Fecha: ${label}`}
                                    />
                                    <Bar dataKey="revenue" fill="#000" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    <div className={styles.tableCard}>
                        <h2 className={`${styles.sectionTitle} ${styles.sectionPadding}`}>Productos más vendidos</h2>
                        {topProducts.length === 0 ? (
                            <div className={styles.emptyState}>Aún no hay ventas en este período.</div>
                        ) : (
                            <div className={styles.tableWrapper}>
                                <table className={styles.table}>
                                    <thead>
                                        <tr>
                                            <th>Producto</th>
                                            <th className={styles.numeric}>Unidades</th>
                                            <th className={styles.numeric}>Ingresos</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {topProducts.map((product) => (
                                            <tr key={product.productId}>
                                                <td>
                                                    <div className={styles.cellMain}>
                                                        <span className={styles.cellTitle}>{product.name}</span>
                                                        <span className={styles.cellSub}>SKU: {product.sku}</span>
                                                    </div>
                                                </td>
                                                <td className={styles.numeric}>{product.units}</td>
                                                <td className={styles.numeric}>{money(product.revenue)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
