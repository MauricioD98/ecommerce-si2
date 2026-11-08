'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, FlaskConical, Info, Loader2, Play, RefreshCw, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import styles from './admin-table.module.scss';
import { intlLocale } from '@/i18n/config';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { SalesForecastService } from '@/service/api/salesForecast.service';
import { ForecastResponse, ForecastSource, ForecastStatus } from '@/types/salesForecast.types';

const POLL_MS = 3000;

const STATUS_BADGE: Record<ForecastStatus, string> = {
    sin_entrenar: styles.badgeMuted,
    entrenando: styles.badgeInfo,
    listo: styles.badgeSuccess,
    datos_insuficientes: styles.badgeWarning,
    error: styles.badgeDanger,
};

// Pronóstico semanal (IA/AS). Consultar nunca entrena: solo el botón inicia un entrenamiento, y la vista
// consulta el estado cada pocos segundos mientras dura.
export default function SalesForecastPanel() {
    const t = useTranslations('Reports.forecast');
    const locale = useLocale();
    const [source, setSource] = useState<ForecastSource>('demo');
    const [data, setData] = useState<ForecastResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [branch, setBranch] = useState('');

    const [reloadKey, setReloadKey] = useState(0);
    const load = useCallback(() => setReloadKey((key) => key + 1), []);

    useEffect(() => {
        let active = true;
        SalesForecastService.get(source)
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

    const changeSource = (value: ForecastSource) => {
        if (value === source) return;
        setLoading(true);
        setData(null);
        setBranch('');
        setSource(value);
    };

    useEffect(() => {
        if (data?.status !== 'entrenando') return;
        const timer = setInterval(load, POLL_MS);
        return () => clearInterval(timer);
    }, [data?.status, load]);

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

    // Fechas de calendario (YYYY-MM-DD, semanas en UTC) tal cual; instantes (entrenado el) en hora local
    const formatDate = (iso: string) =>
        iso.length === 10
            ? new Date(`${iso}T00:00:00Z`).toLocaleDateString(intlLocale(locale), { timeZone: 'UTC', dateStyle: 'medium' })
            : new Date(iso).toLocaleString(intlLocale(locale), { dateStyle: 'medium', timeStyle: 'short' });
    const formatNumber = (value: number, digits = 2) =>
        value.toLocaleString(intlLocale(locale), { minimumFractionDigits: 0, maximumFractionDigits: digits });

    const branches = useMemo(() => {
        const map = new Map<string, string>();
        for (const row of data?.forecast ?? []) if (row.sucursal_id) map.set(row.sucursal_id, row.sucursal_nombre ?? row.sucursal_id);
        return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    }, [data]);
    const rows = useMemo(
        () => (data?.forecast ?? []).filter((row) => !branch || row.sucursal_id === branch || row.sucursal_id === null),
        [data, branch],
    );

    const status = data?.status;
    const result = data?.result;
    const training = status === 'entrenando';

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
                                onClick={() => void run(() => SalesForecastService.train(source))}
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
                                    if (window.confirm(t('deleteDemoConfirm'))) void run(() => SalesForecastService.deleteDemo());
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
                    {status === 'sin_entrenar' && (
                        <div className={`${styles.tableCard} ${styles.emptyState}`}>
                            {data.canTrain ? t('hint.sin_entrenar') : t('hint.sin_entrenar_readonly')}
                        </div>
                    )}
                    {training && (
                        <div className={`${styles.tableCard} ${styles.loadingState}`}>
                            <Loader2 size={18} className={styles.spinner} /> {t('hint.entrenando')}
                        </div>
                    )}
                    {status === 'error' && data.errorCode && (
                        <p className={styles.errorMessage}>{t(`errors.${data.errorCode}`)}</p>
                    )}
                    {status === 'datos_insuficientes' && result && (
                        <div className={`${styles.tableCard} ${styles.emptyState}`}>
                            {t('hint.datos_insuficientes', {
                                weeks: result.datos.semanas_objetivo_elegibles,
                                rows: result.datos.filas_elegibles,
                                minWeeks: result.reglas.min_semanas_objetivo,
                                minRows: result.reglas.min_filas_entrenamiento,
                            })}
                        </div>
                    )}

                    {result && (
                        <div className={styles.statGrid}>
                            <div className={styles.statCard}>
                                <span className={styles.statLabel}>{t('period')}</span>
                                <span className={styles.statValue} style={{ fontSize: '1.1rem' }}>
                                    {formatDate(result.periodo_pronosticado.desde)} – {formatDate(result.periodo_pronosticado.hasta)}
                                </span>
                            </div>
                            <div className={styles.statCard}>
                                <span className={styles.statLabel}>{t('cutoff')}</span>
                                <span className={styles.statValue} style={{ fontSize: '1.1rem' }}>{formatDate(result.corte_datos)}</span>
                            </div>
                            <div className={styles.statCard}>
                                <span className={styles.statLabel}>{t('origin')}</span>
                                <span className={styles.statValue} style={{ fontSize: '1.1rem' }}>
                                    <span className={`${styles.badge} ${result.origen === 'simulado' ? styles.badgeWarning : styles.badgeInfo}`}>
                                        {result.origen === 'simulado' ? t('originDemo') : t('originReal')}
                                    </span>
                                </span>
                            </div>
                            <div className={styles.statCard}>
                                <span className={styles.statLabel}>{t('trainedAt')}</span>
                                <span className={styles.statValue} style={{ fontSize: '1.1rem' }}>{formatDate(result.entrenado_en)}</span>
                                <span className={styles.cellSub}>{t('modelVersion')}: {result.version_modelo}</span>
                            </div>
                        </div>
                    )}

                    {result?.metricas_prueba && result.division && (
                        <div className={`${styles.tableCard} ${styles.chartCard}`}>
                            <h3 className={styles.sectionTitle}>{t('metricsTitle')}</h3>
                            <div className={styles.statGrid}>
                                <div className={styles.statCard}>
                                    <span className={styles.statLabel}>{t('maeModel')}</span>
                                    <span className={styles.statValue}>{formatNumber(result.metricas_prueba.mae_modelo, 3)}</span>
                                </div>
                                <div className={styles.statCard}>
                                    <span className={styles.statLabel}>{t('maeBaseline4')}</span>
                                    <span className={styles.statValue}>{formatNumber(result.metricas_prueba.mae_linea_base_promedio_4_semanas, 3)}</span>
                                </div>
                                <div className={styles.statCard}>
                                    <span className={styles.statLabel}>{t('maeBaseline1')}</span>
                                    <span className={styles.statValue}>{formatNumber(result.metricas_prueba.mae_linea_base_semana_anterior, 3)}</span>
                                </div>
                                <div className={styles.statCard}>
                                    <span className={styles.statLabel}>{t('beatsBaseline')}</span>
                                    <span className={styles.statValue}>{result.metricas_prueba.supera_linea_base_principal ? t('yes') : t('no')}</span>
                                    <span className={styles.cellSub}>{t('testRows', { count: result.metricas_prueba.filas })}</span>
                                </div>
                            </div>
                            <p className={styles.cellSub} style={{ marginTop: '0.75rem' }}>{t('maeHelp')}</p>
                            <h3 className={styles.sectionTitle} style={{ marginTop: '1.25rem' }}>{t('splitTitle')}</h3>
                            <ul style={{ display: 'grid', gap: '0.25rem', paddingLeft: '1.1rem', listStyle: 'disc', color: 'var(--foreground)' }}>
                                {(['entrenamiento', 'prueba'] as const).map((part) => {
                                    const p = result.division![part];
                                    return (
                                        <li key={part}>
                                            {t(part === 'entrenamiento' ? 'splitTrain' : 'splitTest', {
                                                weeks: p.semanas,
                                                rows: p.filas,
                                                from: formatDate(p.desde),
                                                to: formatDate(p.hasta),
                                            })}
                                        </li>
                                    );
                                })}
                            </ul>
                            <p className={styles.cellSub} style={{ marginTop: '0.5rem' }}>
                                {t('splitNote', {
                                    pctWeeks: formatNumber(result.division.porcentaje_semanas_entrenamiento),
                                    pctRows: formatNumber(result.division.porcentaje_filas_entrenamiento),
                                })}
                            </p>
                        </div>
                    )}

                    {result && (
                        <div className={styles.tableCard}>
                            <div className={styles.sectionPadding} style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                <p className={styles.cellSub} style={{ flex: '1 1 20rem' }}>{t('unitsHelp')}</p>
                                {branches.length > 1 && (
                                    <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                        <span className={styles.statLabel} style={{ whiteSpace: 'nowrap' }}>{t('branchFilter')}</span>
                                        <select className={styles.input} value={branch} onChange={(e) => setBranch(e.target.value)}>
                                            <option value="">{t('allBranches')}</option>
                                            {branches.map(([id, name]) => (
                                                <option key={id} value={id}>{name}</option>
                                            ))}
                                        </select>
                                    </label>
                                )}
                            </div>
                            {rows.length === 0 ? (
                                <div className={styles.emptyState}>{t('empty')}</div>
                            ) : (
                                <div className={styles.tableWrapper} style={{ maxHeight: '32rem', overflowY: 'auto' }}>
                                    <table className={styles.table}>
                                        <thead>
                                            <tr>
                                                <th>{t('colBranch')}</th>
                                                <th>{t('colProduct')}</th>
                                                <th>{t('colSize')}</th>
                                                <th className={styles.numeric}>{t('colUnits')}</th>
                                                <th>{t('colMethod')}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {rows.map((row) => (
                                                <tr key={`${row.sucursal_id ?? '-'}:${row.producto_id}:${row.talla ?? '-'}`}>
                                                    <td>{row.sucursal_nombre ?? t('noBranch')}</td>
                                                    <td>
                                                        <div className={styles.cellMain}>
                                                            <span className={styles.cellTitle}>{row.producto_nombre}</span>
                                                            <span className={styles.cellSub}>{row.categoria}</span>
                                                        </div>
                                                    </td>
                                                    <td>{row.talla ?? t('noBranch')}</td>
                                                    <td className={styles.numeric}>
                                                        {row.unidades_previstas === null
                                                            ? '—'
                                                            : `${row.unidades_mostradas} (${formatNumber(row.unidades_previstas)})`}
                                                    </td>
                                                    <td>
                                                        <span
                                                            className={`${styles.badge} ${
                                                                row.metodo === 'modelo'
                                                                    ? styles.badgeSuccess
                                                                    : row.metodo === 'alternativa_promedio'
                                                                      ? styles.badgeWarning
                                                                      : styles.badgeMuted
                                                            }`}
                                                        >
                                                            {t(`method.${row.metodo}`)}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}

                    <div className={`${styles.tableCard} ${styles.chartCard}`}>
                        <h3 className={styles.sectionTitle} style={{ marginBottom: '0.5rem' }}>{t('aboutTitle')}</h3>
                        <p className={styles.cellSub}>{t('aboutText')}</p>
                        <details style={{ marginTop: '0.75rem' }}>
                            <summary
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.375rem',
                                    cursor: 'pointer',
                                    fontWeight: 600,
                                    fontSize: '0.875rem',
                                    color: 'var(--foreground)',
                                }}
                            >
                                <Info size={15} aria-hidden="true" />
                                {t('howTitle')}
                            </summary>
                            <p className={styles.cellSub} style={{ marginTop: '0.5rem' }}>{t('howText')}</p>
                        </details>
                    </div>
                </>
            )}
        </div>
    );
}
