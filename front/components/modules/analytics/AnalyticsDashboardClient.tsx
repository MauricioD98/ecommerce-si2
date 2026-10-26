'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ReactGridLayout, { useContainerWidth } from 'react-grid-layout';
import type { Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { ArrowLeft, GripVertical, Plus, RotateCcw, Save, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import table from '../admin/admin-table.module.scss';
import styles from './analytics-dashboard.module.scss';
import DashboardWidgetView, { seriesColor } from './DashboardWidgetView';
import { analyticsService } from '@/service/api/analytics.service';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { useAdminRole } from '@/hooks/useAdminAccess';
import { useAdminBranches } from '@/hooks/useAdminBranches';
import { useStoreAppearance } from '@/providers/StoreAppearanceProvider';
import {
    AnalyticsMetrics,
    DashboardWidget,
    GRID_COLS,
    MAX_WIDGETS,
    WIDGET_METRICS,
    WIDGET_METRIC_KEYS,
    WidgetMetric,
    WidgetType,
} from '@/types/analytics.types';

const PRESETS = [7, 30, 90] as const;
const DAY_MS = 24 * 60 * 60 * 1000;
// Debajo de este ancho la grilla de 12 columnas queda ilegible: los widgets se apilan y no se arrastran
const STACK_BELOW = 768;
const ROW_HEIGHT = 56;
// Clases globales (no del módulo): react-grid-layout las busca con un selector CSS
const DRAG_HANDLE = 'dashboard-drag-handle';
const NO_DRAG = 'dashboard-no-drag';

// Tamaño mínimo para que cada gráfico se lea
const MIN_SIZE: Record<WidgetType, { minW: number; minH: number }> = {
    KPI: { minW: 2, minH: 2 },
    LINE_CHART: { minW: 3, minH: 3 },
    BAR_CHART: { minW: 3, minH: 3 },
    DONUT_CHART: { minW: 3, minH: 4 },
};

const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const lastDays = (days: number) => {
    const to = new Date();
    return { from: isoDay(new Date(to.getTime() - (days - 1) * DAY_MS)), to: isoDay(to) };
};

// Para comparar el lienzo con el guardado sin que importe el orden del arreglo
const signature = (widgets: DashboardWidget[]) =>
    JSON.stringify([...widgets].sort((a, b) => a.i.localeCompare(b.i)).map(({ i, x, y, w, h, type, metric }) => [i, x, y, w, h, type, metric]));

type Feedback = { type: 'success' | 'error'; text: string } | null;

// Dashboard interactivo: lienzo de widgets que se arrastran (desde el título) y se redimensionan (esquina),
// con los datos de GET /analytics/metrics. "Guardar diseño" manda el lienzo a PUT /analytics/layout.
export default function AnalyticsDashboardClient() {
    const t = useTranslations('AnalyticsDashboard');
    const { isGlobal } = useAdminRole();
    const { branches } = useAdminBranches();
    const { primaryColor } = useStoreAppearance();
    const color = seriesColor(primaryColor);
    const { width, containerRef, mounted } = useContainerWidth();

    const [widgets, setWidgets] = useState<DashboardWidget[]>([]);
    const [saved, setSaved] = useState<DashboardWidget[]>([]);
    const [isDefault, setIsDefault] = useState(false);
    const [layoutLoading, setLayoutLoading] = useState(true);
    const [layoutError, setLayoutError] = useState<string | null>(null);

    const [range, setRange] = useState(() => lastDays(30));
    const [branchId, setBranchId] = useState('');
    const [metrics, setMetrics] = useState<AnalyticsMetrics | null>(null);
    const [metricsError, setMetricsError] = useState<string | null>(null);
    const [metricsLoading, setMetricsLoading] = useState(false);

    const [saving, setSaving] = useState(false);
    const [feedback, setFeedback] = useState<Feedback>(null);
    const [newMetric, setNewMetric] = useState<WidgetMetric>('dailyRevenue');

    useEffect(() => {
        let active = true;
        analyticsService
            .getLayout()
            .then((layout) => {
                if (!active) return;
                setWidgets(layout.widgets);
                setSaved(layout.widgets);
                setIsDefault(layout.isDefault);
            })
            .catch((err) => active && setLayoutError(getApiErrorMessage(err, t('layoutFailed'))))
            .finally(() => active && setLayoutLoading(false));
        return () => {
            active = false;
        };
        // t solo cambia con el idioma
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const rangeInvalid = !range.from || !range.to || range.from > range.to;

    useEffect(() => {
        if (rangeInvalid) return;
        let active = true;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- indicador de carga de la petición que sigue
        setMetricsLoading(true);
        analyticsService
            .getMetrics({ ...range, branchId: isGlobal ? branchId : undefined })
            .then((data) => {
                if (!active) return;
                setMetrics(data);
                setMetricsError(null);
            })
            .catch((err) => active && setMetricsError(getApiErrorMessage(err, t('metricsFailed'))))
            .finally(() => active && setMetricsLoading(false));
        return () => {
            active = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [range, branchId, isGlobal, rangeInvalid]);

    const stacked = mounted && width < STACK_BELOW;
    const dirty = useMemo(() => signature(widgets) !== signature(saved), [widgets, saved]);

    // En móvil: mismo orden visual (de arriba abajo, de izquierda a derecha), a todo el ancho
    const layout: Layout = useMemo(() => {
        if (!stacked) return widgets.map(({ i, x, y, w, h, type }) => ({ i, x, y, w, h, ...MIN_SIZE[type] }));
        let y = 0;
        return [...widgets]
            .sort((a, b) => a.y - b.y || a.x - b.x)
            .map(({ i, h, type }) => {
                const item = { i, x: 0, y, w: GRID_COLS, h: type === 'KPI' ? 2 : Math.max(h, 4) };
                y += item.h;
                return item;
            });
    }, [widgets, stacked]);

    const onLayoutChange = useCallback(
        (next: Layout) => {
            // El apilado de móvil es solo de presentación: no se guarda como diseño
            if (stacked) return;
            setWidgets((current) => {
                let changed = false;
                const updated = current.map((widget) => {
                    const item = next.find((entry) => entry.i === widget.i);
                    if (!item || (item.x === widget.x && item.y === widget.y && item.w === widget.w && item.h === widget.h)) return widget;
                    changed = true;
                    return { ...widget, x: item.x, y: item.y, w: item.w, h: item.h };
                });
                return changed ? updated : current;
            });
        },
        [stacked],
    );

    const addWidget = () => {
        const type = WIDGET_METRICS[newMetric][0];
        const size = type === 'KPI' ? { w: 4, h: 2 } : { w: 6, h: 4 };
        const bottom = widgets.reduce((max, widget) => Math.max(max, widget.y + widget.h), 0);
        // Mismo formato que valida la API: minúsculas, números y guiones
        const id = `${newMetric.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}-${Date.now().toString(36)}`;
        setWidgets((current) => [...current, { i: id, x: 0, y: bottom, ...size, type, metric: newMetric }]);
        setFeedback(null);
    };

    const removeWidget = (id: string) => setWidgets((current) => current.filter((widget) => widget.i !== id));

    const changeType = (id: string, type: WidgetType) =>
        setWidgets((current) =>
            current.map((widget) =>
                widget.i === id
                    ? { ...widget, type, w: Math.max(widget.w, MIN_SIZE[type].minW), h: Math.max(widget.h, MIN_SIZE[type].minH) }
                    : widget,
            ),
        );

    const saveLayout = async () => {
        setSaving(true);
        setFeedback(null);
        try {
            const result = await analyticsService.saveLayout(widgets);
            setWidgets(result.widgets);
            setSaved(result.widgets);
            setIsDefault(false);
            setFeedback({ type: 'success', text: t('saved') });
        } catch (err) {
            setFeedback({ type: 'error', text: getApiErrorMessage(err, t('saveFailed')) });
        } finally {
            setSaving(false);
        }
    };

    const activePreset = PRESETS.find((days) => {
        const preset = lastDays(days);
        return preset.from === range.from && preset.to === range.to;
    });

    return (
        <div className={table.page}>
            <div className={table.pageHeader}>
                <div>
                    <Link href="/admin/reports" className={styles.backLink}>
                        <ArrowLeft size={14} />
                        {t('back')}
                    </Link>
                    <h1>{t('title')}</h1>
                    <p>{t('subtitle')}</p>
                </div>
                <div className={styles.headerActions}>
                    {dirty && (
                        <button type="button" className={table.buttonSecondary} onClick={() => setWidgets(saved)} disabled={saving}>
                            <RotateCcw size={16} />
                            {t('discard')}
                        </button>
                    )}
                    <button type="button" className={table.button} onClick={saveLayout} disabled={saving || !dirty || widgets.length === 0}>
                        <Save size={16} />
                        {saving ? t('saving') : t('save')}
                    </button>
                </div>
            </div>

            {/* Filtros en una fila, arriba de todos los gráficos */}
            <div className={styles.filters}>
                {isGlobal && (
                    <select className={table.input} value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label={t('branchLabel')}>
                        <option value="">{t('allBranches')}</option>
                        {branches.map((branch) => (
                            <option key={branch.id} value={branch.id}>{branch.name}</option>
                        ))}
                    </select>
                )}
                <div className={styles.presets} role="group" aria-label={t('rangeLabel')}>
                    {PRESETS.map((days) => (
                        <button
                            key={days}
                            type="button"
                            className={`${styles.preset} ${activePreset === days ? styles.presetActive : ''}`}
                            aria-pressed={activePreset === days}
                            onClick={() => setRange(lastDays(days))}
                        >
                            {t('lastDays', { days })}
                        </button>
                    ))}
                </div>
                <label className={styles.dateField}>
                    <span>{t('from')}</span>
                    <input type="date" className={table.input} value={range.from} max={range.to} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
                </label>
                <label className={styles.dateField}>
                    <span>{t('to')}</span>
                    <input type="date" className={table.input} value={range.to} min={range.from} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
                </label>
                {metricsLoading && <span className={styles.loadingDot}>{t('updating')}</span>}
            </div>

            {rangeInvalid && <div className={table.errorMessage}>{t('invalidRange')}</div>}
            {metricsError && <div className={table.errorMessage}>{metricsError}</div>}
            {layoutError && <div className={table.errorMessage}>{layoutError}</div>}
            {feedback && <div className={feedback.type === 'success' ? table.successMessage : table.errorMessage}>{feedback.text}</div>}

            {!stacked && (
                <div className={styles.editBar}>
                    <span className={table.cellSub}>{isDefault && !dirty ? t('defaultHint') : t('editHint')}</span>
                    <div className={styles.addWidget}>
                        <select
                            className={table.input}
                            value={newMetric}
                            onChange={(e) => setNewMetric(e.target.value as WidgetMetric)}
                            aria-label={t('addLabel')}
                        >
                            {WIDGET_METRIC_KEYS.map((metric) => (
                                <option key={metric} value={metric}>{t(`metrics.${metric}`)}</option>
                            ))}
                        </select>
                        <button type="button" className={table.buttonSecondary} onClick={addWidget} disabled={widgets.length >= MAX_WIDGETS}>
                            <Plus size={16} />
                            {t('add')}
                        </button>
                    </div>
                </div>
            )}

            <div ref={containerRef} className={styles.canvas}>
                {layoutLoading ? (
                    <div className={table.loadingState}>{t('loading')}</div>
                ) : widgets.length === 0 ? (
                    <div className={table.emptyState}>{t('empty')}</div>
                ) : (
                    mounted && (
                        <ReactGridLayout
                            layout={layout}
                            width={width}
                            gridConfig={{ cols: GRID_COLS, rowHeight: ROW_HEIGHT, margin: [16, 16], containerPadding: [0, 0] }}
                            dragConfig={{ enabled: !stacked, handle: `.${DRAG_HANDLE}`, cancel: `.${NO_DRAG}` }}
                            resizeConfig={{ enabled: !stacked, handles: ['se'] }}
                            onLayoutChange={onLayoutChange}
                        >
                            {widgets.map((widget) => (
                                <section key={widget.i} className={styles.widget} aria-label={t(`metrics.${widget.metric}`)}>
                                    <header className={`${styles.widgetHeader} ${stacked ? '' : DRAG_HANDLE}`}>
                                        {!stacked && <GripVertical size={14} className={styles.grip} aria-hidden />}
                                        <h2>{t(`metrics.${widget.metric}`)}</h2>
                                        {!stacked && (
                                            <div className={`${styles.widgetTools} ${NO_DRAG}`}>
                                                {WIDGET_METRICS[widget.metric].length > 1 && (
                                                    <select
                                                        className={styles.typeSelect}
                                                        value={widget.type}
                                                        onChange={(e) => changeType(widget.i, e.target.value as WidgetType)}
                                                        aria-label={t('chartType')}
                                                    >
                                                        {WIDGET_METRICS[widget.metric].map((type) => (
                                                            <option key={type} value={type}>{t(`types.${type}`)}</option>
                                                        ))}
                                                    </select>
                                                )}
                                                <button
                                                    type="button"
                                                    className={styles.removeButton}
                                                    onClick={() => removeWidget(widget.i)}
                                                    aria-label={t('remove')}
                                                    title={t('remove')}
                                                >
                                                    <X size={14} />
                                                </button>
                                            </div>
                                        )}
                                    </header>
                                    <div className={styles.widgetBody}>
                                        <DashboardWidgetView widget={widget} metrics={metrics} color={color} />
                                    </div>
                                </section>
                            ))}
                        </ReactGridLayout>
                    )
                )}
            </div>
        </div>
    );
}
