'use client';

import React, { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLocale, useTranslations } from 'next-intl';
import styles from './admin-table.module.scss';
import { formatMoney, intlLocale } from '@/i18n/config';
import { useSalesReport } from '@/hooks/useReports';
import { useAdminBranches } from '@/hooks/useAdminBranches';
import { useAdminRole } from '@/hooks/useAdminAccess';

// La etiqueta de cada rango es Reports.ranges.<días>
const RANGES = [7, 30, 90] as const;

export default function GeneralMetrics() {
    const { isGlobal } = useAdminRole();
    const t = useTranslations('Reports');
    const locale = useLocale();
    const money = (value: number) => formatMoney(value, locale);
    const { branches } = useAdminBranches();
    // '' = todas las sucursales; sin alcance global el backend usa siempre la propia
    const [branchId, setBranchId] = useState('');
    const [days, setDays] = useState(30);
    const { overview, topProducts, error, isLoading } = useSalesReport(isGlobal ? branchId : '', days);

    const cards = overview
        ? [
              { label: t('revenue'), value: money(overview.totalRevenue), hint: t('paidOrders', { count: overview.paidOrders }) },
              { label: t('orders'), value: String(overview.totalOrders), hint: t('delivered', { count: overview.completedOrders }) },
              { label: t('averageTicket'), value: money(overview.averageOrderValue), hint: t('perPaidOrder') },
              { label: t('pending'), value: String(overview.pendingOrders), hint: t('cancelled', { count: overview.cancelledOrders }) },
              { label: t('employeeDiscounts'), value: money(overview.totalDiscounts), hint: t('inPaidOrders') },
          ]
        : [];

    return (
        <div className={styles.page}>
            <div className={styles.toolbar}>
                {isGlobal && (
                    <select className={styles.input} value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label={t('branchLabel')}>
                        <option value="">{t('allBranches')}</option>
                        {branches.map((branch) => (
                            <option key={branch.id} value={branch.id}>{branch.name}</option>
                        ))}
                    </select>
                )}
                <select className={styles.input} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label={t('rangeLabel')}>
                    {RANGES.map((range) => (
                        <option key={range} value={range}>{t(`ranges.${range}`)}</option>
                    ))}
                </select>
            </div>

            {error && <div className={styles.errorMessage}>{error}</div>}

            {isLoading && !overview ? (
                <div className={styles.tableCard}><div className={styles.loadingState}>{t('loading')}</div></div>
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
                        <h2 className={styles.sectionTitle}>{t('revenueByDay')}</h2>
                        <div className={styles.chart}>
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={overview.salesByDay} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                                    <XAxis dataKey="date" tickFormatter={(date: string) => date.slice(5)} tick={{ fontSize: 12 }} minTickGap={16} />
                                    <YAxis tick={{ fontSize: 12 }} width={56} tickFormatter={(value: number) => `Bs ${value.toLocaleString(intlLocale(locale))}`} />
                                    <Tooltip
                                        formatter={(value) => [money(Number(value)), t('revenue')]}
                                        labelFormatter={(label) => t('dateLabel', { date: String(label) })}
                                    />
                                    <Bar dataKey="revenue" fill="#000" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    <div className={styles.tableCard}>
                        <h2 className={`${styles.sectionTitle} ${styles.sectionPadding}`}>{t('topProducts')}</h2>
                        {topProducts.length === 0 ? (
                            <div className={styles.emptyState}>{t('noSales')}</div>
                        ) : (
                            <div className={styles.tableWrapper}>
                                <table className={styles.table}>
                                    <thead>
                                        <tr>
                                            <th>{t('product')}</th>
                                            <th className={styles.numeric}>{t('units')}</th>
                                            <th className={styles.numeric}>{t('revenue')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {topProducts.map((product) => (
                                            <tr key={product.productId}>
                                                <td>
                                                    <div className={styles.cellMain}>
                                                        <span className={styles.cellTitle}>{product.name}</span>
                                                        <span className={styles.cellSub}>{t('sku', { sku: product.sku })}</span>
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
