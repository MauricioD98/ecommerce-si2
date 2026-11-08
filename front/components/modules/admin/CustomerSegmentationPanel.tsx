'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, FlaskConical, Info, Loader2, Play, RefreshCw, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import styles from './admin-table.module.scss';
import { intlLocale } from '@/i18n/config';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { CustomerSegmentationService } from '@/service/api/customerSegmentation.service';
import {
    SegmentationResponse,
    SegmentationSource,
    SegmentationStatus,
    SegmentMetrics,
    SegmentVariable,
} from '@/types/customerSegmentation.types';

const POLL_MS = 3000;
const VARIABLES: SegmentVariable[] = ['recencia_dias', 'frecuencia', 'monto'];

const STATUS_BADGE: Record<SegmentationStatus, string> = {
    sin_entrenar: styles.badgeMuted,
    entrenando: styles.badgeInfo,
    listo: styles.badgeSuccess,
    datos_insuficientes: styles.badgeWarning,
    error: styles.badgeDanger,
};

// Segmentación de clientes (IA/ANS). Consultar nunca entrena: solo el botón inicia un entrenamiento, y la vista
// consulta el estado cada pocos segundos mientras dura. Solo muestra resultados agregados por grupo.
export default function CustomerSegmentationPanel() {
    const t = useTranslations('Reports.segments');
    const locale = useLocale();
    const [source, setSource] = useState<SegmentationSource>('demo');
    const [data, setData] = useState<SegmentationResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const load = useCallback(() => setReloadKey((key) => key + 1), []);

    useEffect(() => {
        let active = true;
        CustomerSegmentationService.get(source)
            .then((response) => {
                if (!active) return;
                setData(response);
                setError(null);
            })
            .catch((err) => {
                if (active) setError(getApiErrorMessage(err, t('loadFailed')));
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [source, reloadKey, t]);

    useEffect(() => {
        if (data?.status !== 'entrenando') return;
        const timer = setInterval(load, POLL_MS);
        return () => clearInterval(timer);
    }, [data?.status, load]);

    const changeSource = (value: SegmentationSource) => {
        if (value === source) return;
        setLoading(true);
        setData(null);
        setSource(value);
    };

    const run = async (action: () => Promise<void>) => {
        setBusy(true);
        try {
            await action();
            load();
        } catch (err) {
            setError(getApiErrorMessage(err, t('loadFailed')));
        } finally {
            setBusy(false);
        }
    };

    const nf = (value: number, digits = 0) =>
        value.toLocaleString(intlLocale(locale), { minimumFractionDigits: digits, maximumFractionDigits: digits });
    const date = (iso: string, withTime = false) =>
        new Date(iso).toLocaleString(intlLocale(locale), withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium', timeZone: 'UTC' });
    // El corte se muestra en UTC (la zona horaria del análisis), no en la hora local del navegador
    const utcInstant = (iso: string) =>
        `${new Date(iso).toLocaleString(intlLocale(locale), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC`;
    const metric = (value: number | null) => (value === null ? t('notAvailable') : nf(value, 3));

    const status = data?.status;
    const result = data?.result;
    const training = status === 'entrenando';
    const money = (value: number) => `${result?.moneda === 'BOB' ? 'Bs' : (result?.moneda ?? '')} ${nf(value, 2)}`;
    const formatValue = (variable: SegmentVariable, value: number) =>
        variable === 'monto' ? money(value) : variable === 'recencia_dias' ? t('daysValue', { n: Math.round(value) }) : t('ordersValue', { n: Math.round(value) });
    // Último día incluido del periodo (el corte es exclusivo)
    const lastDay = result ? new Date(new Date(result.periodo.hasta_exclusivo).getTime() - 1).toISOString() : '';

    const metricsRow = (label: string, m: SegmentMetrics) => (
        <tr>
            <td>{label}</td>
            <td className={styles.numeric}>{m.clientes}</td>
            <td className={styles.numeric}>{m.grupos_con_clientes}</td>
            <td className={styles.numeric}>{metric(m.silhouette)}</td>
            <td className={styles.numeric}>{metric(m.davies_bouldin)}</td>
            <td className={styles.numeric}>{nf(m.inercia_media, 3)}</td>
        </tr>
    );

    return (
        <div className={styles.page}>
            <div className={`${styles.tableCard} ${styles.sectionPadding}`} style={{ paddingBottom: '1.25rem' }}>
                <h2 className={styles.sectionTitle} style={{ marginBottom: '0.25rem' }}>{t('title')}</h2>
                <p className={styles.cellSub} style={{ marginBottom: '1rem' }}>{t('subtitle')}</p>

                <div className={styles.toolbar} style={{ flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
                    <div className={styles.tabs} role="tablist" aria-label={t('sourceLabel')} style={{ marginBottom: 0 }}>
                        {(['demo', 'real'] as const).map((value) => (
                            <button
                                key={value}
                                type="button"
                                role="tab"
                                aria-selected={source === value}
                                className={`${styles.tab} ${source === value ? styles.tabActive : ''}`}
                                onClick={() => changeSource(value)}
                                disabled={busy}
                            >
                                {value === 'demo' ? <FlaskConical size={14} style={{ marginRight: 6 }} /> : null}
                                {value === 'demo' ? t('sourceDemo') : t('sourceReal')}
                            </button>
                        ))}
                    </div>
                    {status && <span className={`${styles.badge} ${STATUS_BADGE[status]}`}>{t(`status.${status}`)}</span>}
                    <div style={{ display: 'flex', gap: '0.5rem', marginLeft: 'auto', flexWrap: 'wrap' }}>
                        <button type="button" className={styles.buttonSecondary} onClick={load} disabled={busy || loading}>
                            <RefreshCw size={14} />
                            {t('refresh')}
                        </button>
                        {data?.canTrain && (
                            <button
                                type="button"
                                className={styles.button}
                                disabled={busy || training}
                                onClick={() => void run(() => CustomerSegmentationService.train(source))}
                            >
                                {busy || training ? <Loader2 size={14} className={styles.spinner} /> : <Play size={14} />}
                                {result ? t('retrain') : source === 'demo' ? t('trainDemo') : t('train')}
                            </button>
                        )}
                        {data?.canTrain && source === 'demo' && status !== 'sin_entrenar' && (
                            <button
                                type="button"
                                className={styles.buttonDanger}
                                disabled={busy || training}
                                onClick={() => {
                                    if (window.confirm(t('deleteDemoConfirm'))) void run(() => CustomerSegmentationService.deleteDemo());
                                }}
                            >
                                <Trash2 size={14} />
                                {t('deleteDemo')}
                            </button>
                        )}
                    </div>
                </div>

                <div
                    className={styles.syncBanner}
                    role="note"
                    style={{
                        marginTop: '1rem',
                        justifyContent: 'flex-start',
                        background: source === 'demo' ? '#fef3c7' : '#e0f2fe',
                        color: source === 'demo' ? '#92400e' : '#0369a1',
                        fontWeight: source === 'demo' ? 700 : 500,
                    }}
                >
                    <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                        {source === 'demo' ? <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /> : null}
                        <span>{source === 'demo' ? t('simulatedBanner') : t('realBanner')}</span>
                    </span>
                </div>
            </div>

            {error && <p className={styles.errorMessage}>{error}</p>}
            {loading && <div className={`${styles.tableCard} ${styles.loadingState}`}>{t('loading')}</div>}

            {!loading && data && (
                <>
                    {status === 'sin_entrenar' && <div className={`${styles.tableCard} ${styles.emptyState}`}>{t('hint.sin_entrenar')}</div>}
                    {training && (
                        <div className={`${styles.tableCard} ${styles.loadingState}`}>
                            <Loader2 size={18} className={styles.spinner} /> {t('hint.entrenando')}
                        </div>
                    )}
                    {status === 'error' && data.errorCode && <p className={styles.errorMessage}>{t(`errors.${data.errorCode}`)}</p>}
                    {status === 'datos_insuficientes' && result && (
                        <div className={`${styles.tableCard} ${styles.emptyState}`}>
                            <strong>{t('insufficientTitle')}</strong>
                            <p style={{ marginTop: '0.5rem' }}>
                                {t(`insufficient.${result.codigo_motivo ?? 'pocos_clientes'}`, {
                                    eligible: result.datos.clientes.elegibles,
                                    min: result.reglas.min_clientes,
                                    points: result.diversidad_entrenamiento?.puntos_distintos ?? 0,
                                    minPoints: result.reglas.min_puntos_distintos_entrenamiento,
                                })}
                            </p>
                        </div>
                    )}

                    {result && (
                        <div className={styles.statGrid}>
                            <div className={styles.statCard}>
                                <span className={styles.statLabel}>{t('period')}</span>
                                <span className={styles.statValue} style={{ fontSize: '1.05rem' }}>
                                    {date(result.periodo.desde)} – {date(lastDay)}
                                </span>
                                <span className={styles.cellSub}>{t('periodHint', { days: result.periodo.dias, tz: result.zona_horaria })}</span>
                            </div>
                            <div className={styles.statCard}>
                                <span className={styles.statLabel}>{t('customers')}</span>
                                <span className={styles.statValue}>{result.datos.clientes.elegibles}</span>
                                <span className={styles.cellSub}>
                                    {t('customersHint', {
                                        total: result.datos.clientes.total,
                                        noValid: result.datos.clientes.sin_compras_validas,
                                        noPeriod: result.datos.clientes.sin_compras_en_periodo,
                                    })}
                                </span>
                            </div>
                            <div className={styles.statCard}>
                                <span className={styles.statLabel}>{t('origin')}</span>
                                <span className={styles.statValue} style={{ fontSize: '1.05rem' }}>
                                    <span className={`${styles.badge} ${result.origen === 'simulado' ? styles.badgeWarning : styles.badgeInfo}`}>
                                        {result.origen === 'simulado' ? t('originDemo') : t('originReal')}
                                    </span>
                                </span>
                                <span className={styles.cellSub}>{t('cutoff', { date: utcInstant(result.corte) })}</span>
                            </div>
                            <div className={styles.statCard}>
                                <span className={styles.statLabel}>{t('trainedAt')}</span>
                                <span className={styles.statValue} style={{ fontSize: '1.05rem' }}>{date(result.entrenado_en, true)}</span>
                                <span className={styles.cellSub}>
                                    {t('modelVersion')}: {result.version_modelo}
                                    {result.modelo ? ` · ${result.modelo.id}` : ''} · {t('noAutoUpdate')}
                                </span>
                            </div>
                        </div>
                    )}

                    {result && result.grupos.length > 0 && (
                        <div className={`${styles.tableCard} ${styles.chartCard}`}>
                            <h3 className={styles.sectionTitle}>{t('groupsTitle', { k: result.grupos.length })}</h3>
                            <p className={styles.cellSub} style={{ marginBottom: '1rem' }}>{t('groupsHelp')}</p>
                            <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 17rem), 1fr))' }}>
                                {result.grupos.map((g) => (
                                    <div key={g.grupo} className={styles.statCard} style={{ gap: '0.6rem', color: 'var(--foreground)' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem' }}>
                                            <span style={{ fontWeight: 700, color: 'var(--foreground)' }}>{t('group', { n: g.grupo })}</span>
                                            <span className={styles.cellSub}>{t('groupCount', { count: g.clientes, pct: nf(g.porcentaje, 1) })}</span>
                                        </div>
                                        <div aria-hidden="true" style={{ height: 6, borderRadius: 3, background: 'var(--border, #e5e7eb)', overflow: 'hidden' }}>
                                            <div style={{ width: `${Math.max(g.porcentaje, 1)}%`, height: '100%', background: 'var(--primary, #2a78d6)', borderRadius: 3 }} />
                                        </div>
                                        <ul style={{ listStyle: 'disc', paddingLeft: '1.1rem', display: 'grid', gap: '0.15rem', fontSize: '0.875rem', color: 'var(--foreground)' }}>
                                            {VARIABLES.map((v) => (
                                                <li key={v} style={{ color: 'var(--foreground)' }}>{t(`compare.${v}.${g.comparacion_con_tienda[v]}`)}</li>
                                            ))}
                                        </ul>
                                        <div style={{ display: 'grid', gap: '0.4rem', fontSize: '0.85rem', borderTop: '1px solid var(--border)', paddingTop: '0.6rem' }}>
                                            {VARIABLES.map((v) => (
                                                <div key={v} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                                                    <span className={styles.cellSub}>{t(`variable.${v}`)}</span>
                                                    <span style={{ textAlign: 'right', color: 'var(--foreground)' }}>
                                                        <span style={{ fontWeight: 600 }}>{formatValue(v, g.rfm[v].mediana)}</span>
                                                        <span className={styles.cellSub} style={{ display: 'block', fontSize: '0.75rem' }}>
                                                            {formatValue(v, g.rfm[v].p25)} – {formatValue(v, g.rfm[v].p75)}
                                                        </span>
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <p className={styles.cellSub} style={{ marginTop: '0.75rem' }}>{t('medianHelp')}</p>
                        </div>
                    )}

                    {result?.division && result.metricas && (
                        <div className={`${styles.tableCard} ${styles.chartCard}`}>
                            <h3 className={styles.sectionTitle}>{t('evaluationTitle')}</h3>
                            <p style={{ marginBottom: '0.75rem', color: 'var(--foreground)' }}>
                                {t('split', {
                                    total: result.division.total,
                                    train: result.division.entrenamiento,
                                    test: result.division.evaluacion,
                                    seed: result.division.semilla,
                                    k: result.modelo?.k ?? result.grupos.length,
                                })}
                            </p>
                            <div className={styles.tableWrapper}>
                                <table className={styles.table}>
                                    <thead>
                                        <tr>
                                            <th>{t('colSet')}</th>
                                            <th className={styles.numeric}>{t('colCustomers')}</th>
                                            <th className={styles.numeric}>{t('colGroups')}</th>
                                            <th className={styles.numeric}>Silhouette</th>
                                            <th className={styles.numeric}>Davies-Bouldin</th>
                                            <th className={styles.numeric}>{t('colInertia')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {metricsRow(t('setTrain'), result.metricas.entrenamiento)}
                                        {metricsRow(t('setTest'), result.metricas.evaluacion)}
                                    </tbody>
                                </table>
                            </div>
                            <p className={styles.cellSub} style={{ marginTop: '0.75rem' }}>{t('metricsHelp')}</p>
                            {result.advertencias.length > 0 && (
                                <ul style={{ marginTop: '0.75rem', display: 'grid', gap: '0.25rem' }}>
                                    {result.advertencias.map((w) => (
                                        <li key={w.codigo} className={styles.cellSub} style={{ display: 'flex', gap: '0.4rem' }}>
                                            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
                                            {t(`warnings.${w.codigo}`, { k: w.k ?? 0, n: w.n ?? 0, threshold: w.umbral ?? 0 })}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}

                    <div className={`${styles.tableCard} ${styles.chartCard}`}>
                        <h3 className={styles.sectionTitle} style={{ marginBottom: '0.5rem' }}>{t('aboutTitle')}</h3>
                        <p className={styles.cellSub}>{t('aboutText')}</p>
                        <details style={{ marginTop: '0.75rem' }}>
                            <summary
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem', color: 'var(--foreground)' }}
                            >
                                <Info size={15} aria-hidden="true" />
                                {t('howTitle')}
                            </summary>
                            <ul className={styles.cellSub} style={{ marginTop: '0.5rem', paddingLeft: '1.1rem', listStyle: 'disc', display: 'grid', gap: '0.3rem' }}>
                                {(['rfm', 'valid', 'amount', 'split', 'model', 'limits'] as const).map((key) => (
                                    <li key={key}>{t(`how.${key}`)}</li>
                                ))}
                                {result && (
                                    <li>
                                        {t('how.dataQuality', {
                                            rows: result.datos.pedidos.filas_leidas,
                                            duplicates: result.datos.pedidos.duplicados_exactos_descartados,
                                            excluded: Object.values(result.datos.pedidos.excluidos).reduce((a, b) => a + b, 0),
                                            pending: result.datos.pedidos.pendientes,
                                            cancelled: result.datos.pedidos.cancelados,
                                            returns: result.datos.devoluciones.pedidos_con_devolucion,
                                        })}
                                    </li>
                                )}
                            </ul>
                        </details>
                    </div>
                </>
            )}
        </div>
    );
}
