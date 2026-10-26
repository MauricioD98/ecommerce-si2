'use client';

import React from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLocale, useTranslations } from 'next-intl';
import { formatMoney, intlLocale } from '@/i18n/config';
import type { AnalyticsMetrics, DashboardWidget } from '@/types/analytics.types';
import styles from './analytics-dashboard.module.scss';

// Paleta categórica para la dona (5 productos), en orden fijo: validada con el validador de la guía de
// dataviz (CVD ΔE ≥ 9.1, visión normal ≥ 19.6). Tres tonos quedan bajo 3:1 sobre blanco, por eso la dona
// siempre lleva su leyenda con nombre y unidades visibles.
const CATEGORICAL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];
// Serie única cuando el color de la tienda no se distingue sobre el fondo blanco (p. ej. crema)
const FALLBACK_SERIES = '#2a78d6';
const GRID = '#e5e7eb';
const AXIS_TICK = { fontSize: 11, fill: '#6b7280' };

const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Color de la marca para las series únicas, si contrasta al menos 3:1 con el fondo blanco del widget. */
export function seriesColor(brand: string): string {
    if (!/^#[0-9a-f]{6}$/i.test(brand)) return FALLBACK_SERIES;
    return 1.05 / (luminance(brand) + 0.05) >= 3 ? brand : FALLBACK_SERIES;
}

interface Props {
    widget: DashboardWidget;
    metrics: AnalyticsMetrics | null;
    color: string;
}

// Contenido de un widget según su métrica y tipo de gráfico. El marco (título, asa, quitar) lo pone el lienzo.
export default function DashboardWidgetView({ widget, metrics, color }: Props) {
    const t = useTranslations('AnalyticsDashboard');
    const locale = useLocale();
    const money = (value: number) => formatMoney(value, locale);
    const number = (value: number) => value.toLocaleString(intlLocale(locale));

    if (!metrics) return <div className={styles.widgetEmpty}>{t('loading')}</div>;

    if (widget.type === 'KPI') {
        const { totals } = metrics;
        const kpi = {
            totalRevenue: { value: money(totals.revenue), hint: t('kpi.paidOrders', { count: totals.paidOrders }) },
            totalOrders: { value: number(totals.totalOrders), hint: t('kpi.paidOrders', { count: totals.paidOrders }) },
            averageTicket: { value: money(totals.averageTicket), hint: t('kpi.perPaidOrder') },
        }[widget.metric as 'totalRevenue' | 'totalOrders' | 'averageTicket'];
        if (!kpi) return null;
        return (
            <div className={styles.kpi}>
                <span className={styles.kpiValue}>{kpi.value}</span>
                <span className={styles.kpiHint}>{kpi.hint}</span>
            </div>
        );
    }

    if (widget.metric === 'dailyRevenue' || widget.metric === 'dailyOrders') {
        const key = widget.metric === 'dailyRevenue' ? 'revenue' : 'orders';
        const format = key === 'revenue' ? money : number;
        const label = key === 'revenue' ? t('series.revenue') : t('series.orders');
        const axis = {
            x: <XAxis dataKey="date" tickFormatter={(date: string) => date.slice(5)} tick={AXIS_TICK} minTickGap={20} tickLine={false} axisLine={{ stroke: GRID }} />,
            y: (
                <YAxis
                    tick={AXIS_TICK}
                    width={key === 'revenue' ? 64 : 36}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={key === 'revenue'}
                    tickFormatter={(value: number) => (key === 'revenue' ? `Bs ${number(value)}` : number(value))}
                />
            ),
            tooltip: (
                <Tooltip
                    formatter={(value) => [format(Number(value)), label]}
                    labelFormatter={(date) => t('dateLabel', { date: String(date) })}
                    cursor={widget.type === 'BAR_CHART' ? { fill: '#f3f4f6' } : { stroke: '#9ca3af', strokeDasharray: '3 3' }}
                />
            ),
        };
        return (
            <div className={styles.chartBody}>
                <ResponsiveContainer width="100%" height="100%">
                    {widget.type === 'BAR_CHART' ? (
                        <BarChart data={metrics.dailyRevenue} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID} />
                            {axis.x}
                            {axis.y}
                            {axis.tooltip}
                            <Bar dataKey={key} fill={color} radius={[4, 4, 0, 0]} maxBarSize={28} />
                        </BarChart>
                    ) : (
                        <LineChart data={metrics.dailyRevenue} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID} />
                            {axis.x}
                            {axis.y}
                            {axis.tooltip}
                            <Line type="monotone" dataKey={key} stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }} />
                        </LineChart>
                    )}
                </ResponsiveContainer>
            </div>
        );
    }

    // Top 5 productos
    const products = metrics.topProducts;
    if (products.length === 0) return <div className={styles.widgetEmpty}>{t('noSales')}</div>;
    const unitsLabel = t('series.units');

    if (widget.type === 'BAR_CHART') {
        return (
            <div className={styles.chartBody}>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={products} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={GRID} />
                        <XAxis type="number" tick={AXIS_TICK} allowDecimals={false} tickLine={false} axisLine={{ stroke: GRID }} />
                        <YAxis type="category" dataKey="name" tick={AXIS_TICK} width={110} tickLine={false} axisLine={false} />
                        <Tooltip formatter={(value) => [number(Number(value)), unitsLabel]} cursor={{ fill: '#f3f4f6' }} />
                        <Bar dataKey="units" fill={color} radius={[0, 4, 4, 0]} maxBarSize={22} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        );
    }

    const total = products.reduce((sum, product) => sum + product.units, 0);
    return (
        <div className={styles.donut}>
            <div className={styles.donutChart}>
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Tooltip formatter={(value, name) => [`${number(Number(value))} ${unitsLabel.toLowerCase()}`, String(name)]} />
                        <Pie
                            data={products}
                            dataKey="units"
                            nameKey="name"
                            innerRadius="58%"
                            outerRadius="92%"
                            paddingAngle={1}
                            stroke="#fff"
                            strokeWidth={2}
                            isAnimationActive={false}
                        >
                            {products.map((product, index) => (
                                <Cell key={product.productId} fill={CATEGORICAL[index % CATEGORICAL.length]} />
                            ))}
                        </Pie>
                    </PieChart>
                </ResponsiveContainer>
                <div className={styles.donutCenter} aria-hidden>
                    <strong>{number(total)}</strong>
                    <span>{unitsLabel}</span>
                </div>
            </div>
            {/* Leyenda con valores: la identidad nunca depende solo del color */}
            <ul className={styles.legend}>
                {products.map((product, index) => (
                    <li key={product.productId}>
                        <span className={styles.legendSwatch} style={{ background: CATEGORICAL[index % CATEGORICAL.length] }} aria-hidden />
                        <span className={styles.legendName} title={product.name}>{product.name}</span>
                        <span className={styles.legendValue}>{number(product.units)}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
