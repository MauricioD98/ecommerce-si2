'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CalendarRange, Check, Copy, FileDown, FileSpreadsheet, FileText, HelpCircle, Info, Loader2, Lock, Mic, MicOff, SearchX, Send, Sparkles } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import styles from './admin-table.module.scss';
import { intlLocale } from '@/i18n/config';
import { DynamicReportEntry, useDynamicReport } from '@/hooks/useReports';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { DynamicReportResult } from '@/types/admin.types';
import type { User } from '@/types/auth.types';
import { useAuth } from '@/hooks/useAuth';
import { useStoreName } from '@/providers/StoreInfoProvider';
import { buildReportDocument, exportReportExcel, exportReportPdf, reportFilename, reportTitle } from '@/utils/reportExport';
import {
    columnKind,
    columnLabel,
    dateTimeParts,
    exportValue,
    formatValue,
    refineKind,
    type ColumnKind,
    type FormatContext,
    type Labels,
} from '@/utils/reportFormat';

const DEFAULT_TIMEZONE = 'America/La_Paz';

interface ColumnInfo {
    key: string;
    kind: ColumnKind;
    label: string;
}

// Contexto de formato: idioma de la interfaz + zona y moneda DEL REPORTE (las mismas que usó la consulta)
function useFormatContext(result: DynamicReportResult): { ctx: FormatContext; labels: Labels } {
    const locale = useLocale();
    const t = useTranslations('Reports.dynamic');
    return {
        ctx: {
            locale: intlLocale(locale),
            timeZone: result.interpretation?.zonaHoraria ?? DEFAULT_TIMEZONE,
            currency: result.interpretation?.moneda ?? 'BOB',
        },
        labels: { yes: t('view.yes'), no: t('view.no'), empty: '—' },
    };
}

// Tipo y nombre legible de cada columna. Un identificador interno (o el número de pedido, que en este
// sistema es un código como "cmw86c2n…", no un correlativo) se presenta como "Referencia".
function useColumns(result: DynamicReportResult): ColumnInfo[] {
    const t = useTranslations('Reports.dynamic');
    const { ctx } = useFormatContext(result);
    return useMemo(() => {
        const keys = result.columns.length > 0 ? result.columns : Object.keys(result.rows[0] ?? {});
        return keys.map((key) => {
            const values = result.rows.map((row) => row[key]);
            const kind = refineKind(columnKind(key, values), values, ctx);
            let label = columnLabel(key);
            if (kind === 'reference') {
                const base = key.toLowerCase().replace(/(^id$|_id$|^order_number$|^numero_(pedido|venta|orden)$|^referencia_?)/, '').replace(/_/g, ' ').trim();
                label = base ? t('view.referenceOf', { name: base }) : t('view.reference');
            }
            return { key, kind, label };
        });
    }, [result, t, ctx]);
}

// CSV: encabezados legibles; números como números (sin redondear ni símbolo), fechas en la hora
// local del reporte ("2026-11-08 14:36:55"), referencias completas
function toExportRows(result: DynamicReportResult, columns: ColumnInfo[], ctx: FormatContext, labels: Labels): Record<string, unknown>[] {
    return result.rows.map((row) => Object.fromEntries(columns.map((c) => [c.label, exportValue(c.kind, row[c.key], ctx, labels)])));
}

async function exportCsv(rows: Record<string, unknown>[], filename: string, sheetName: string) {
    const XLSX = await import('xlsx');
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    XLSX.writeFile(workbook, `${filename}.csv`, { bookType: 'csv' });
}

function userDisplayName(user: User | null | undefined): string {
    if (!user) return '';
    const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    return full || user.name || user.email;
}

// Excel y PDF con formato de informe: el título es la pregunta y también da nombre al archivo
// (titulo_en_snake_case_AAAA-MM-DD). `primaryColor` permite el color principal del tenant (por defecto azul marino).
function ExportBar({ entry, viaVoice, primaryColor }: { entry: DynamicReportEntry; viaVoice: boolean; primaryColor?: string }) {
    const result = entry.result as DynamicReportResult;
    const t = useTranslations('Reports.dynamic');
    const { ctx, labels } = useFormatContext(result);
    const columns = useColumns(result);
    const storeName = useStoreName();
    const { user } = useAuth();
    const disabled = result.rows.length === 0;
    const title = reportTitle(entry.prompt);

    const buildDocument = () => {
        const generatedAt = new Date();
        const doc = buildReportDocument(result.rows, columns, ctx, labels, {
            title,
            store: storeName,
            period: result.interpretation?.periodo,
            user: userDisplayName(user),
            voiceQuery: viaVoice ? entry.prompt : undefined,
            generatedAt,
            primaryColor,
        });
        return { doc, filename: reportFilename(title, generatedAt, ctx.timeZone, t('fileFallback')) };
    };

    return (
        <div className={styles.exportBar}>
            <button
                type="button"
                className={styles.exportButton}
                disabled={disabled}
                onClick={() => {
                    const { doc, filename } = buildDocument();
                    void exportReportPdf(doc, filename);
                }}
                title={t('exportPdf')}
            >
                <FileText size={14} />
                PDF
            </button>
            <button
                type="button"
                className={styles.exportButton}
                disabled={disabled}
                onClick={() => {
                    const { doc, filename } = buildDocument();
                    void exportReportExcel(doc, filename);
                }}
                title={t('exportExcel')}
            >
                <FileSpreadsheet size={14} />
                Excel
            </button>
            <button
                type="button"
                className={styles.exportButton}
                disabled={disabled}
                onClick={() => exportCsv(toExportRows(result, columns, ctx, labels), buildDocument().filename, t('sheetName'))}
                title={t('exportCsv')}
            >
                <FileDown size={14} />
                CSV
            </button>
        </div>
    );
}

// Referencia abreviada con botón para copiar el identificador completo
function ReferenceValue({ value, text }: { value: string; text: string }) {
    const t = useTranslations('Reports.dynamic');
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // Sin permiso de portapapeles: el valor completo sigue disponible en el título
        }
    };
    return (
        <span className={styles.reportReference} title={value}>
            <code>{text}</code>
            <button type="button" className={styles.reportCopyButton} onClick={copy} aria-label={t('view.copyTitle')} title={t('view.copyTitle')}>
                {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
                <span>{copied ? t('view.copied') : t('view.copy')}</span>
            </button>
        </span>
    );
}

function CellValue({ column, value, ctx, labels }: { column: ColumnInfo; value: unknown; ctx: FormatContext; labels: Labels }) {
    const text = formatValue(column.kind, value, ctx, labels);
    if (column.kind === 'reference' && typeof value === 'string' && value) return <ReferenceValue value={value} text={text} />;
    if (value === null || value === undefined) return <span className={styles.reportEmpty}>{text}</span>;
    return <>{text}</>;
}

// Una fila con pocas columnas: datos destacados (las fechas con hora se separan en Fecha y Hora)
function ResultSummary({ result, columns }: { result: DynamicReportResult; columns: ColumnInfo[] }) {
    const t = useTranslations('Reports.dynamic');
    const { ctx, labels } = useFormatContext(result);
    const row = result.rows[0];
    const datetimeColumns = columns.filter((c) => c.kind === 'datetime');
    const items: { key: string; label: string; node: React.ReactNode; big: boolean }[] = [];

    for (const column of columns) {
        const value = row[column.key];
        if (column.kind === 'datetime' && typeof value === 'string') {
            const parts = dateTimeParts(value, ctx, 'long');
            if (parts) {
                const prefix = datetimeColumns.length > 1 ? `${column.label} · ` : '';
                items.push({ key: `${column.key}-date`, label: `${prefix}${t('view.date')}`, node: parts.date, big: false });
                if (parts.time) items.push({ key: `${column.key}-time`, label: `${prefix}${t('view.time')}`, node: parts.time, big: false });
                continue;
            }
        }
        const numeric = ['money', 'count', 'number', 'percent'].includes(column.kind);
        items.push({ key: column.key, label: column.label, node: <CellValue column={column} value={value} ctx={ctx} labels={labels} />, big: numeric });
    }

    return (
        <div className={styles.reportSummary} role="group" aria-label={t('view.result')}>
            {items.map((item) => (
                <div key={item.key} className={`${styles.reportStat} ${item.big ? styles.reportStatBig : ''}`}>
                    <span className={styles.reportStatLabel}>{item.label}</span>
                    <span className={styles.reportStatValue}>{item.node}</span>
                </div>
            ))}
        </div>
    );
}

// Varias filas: tabla; en pantallas angostas cada fila se apila como tarjeta (data-label)
function ResultTable({ result, columns }: { result: DynamicReportResult; columns: ColumnInfo[] }) {
    const { ctx, labels } = useFormatContext(result);
    const numeric = (kind: ColumnKind) => ['money', 'count', 'number', 'percent'].includes(kind);
    return (
        <div className={styles.tableWrapper}>
            <table className={`${styles.table} ${styles.reportTable}`}>
                <thead>
                    <tr>
                        {columns.map((c) => (
                            <th key={c.key} className={numeric(c.kind) ? styles.reportNumeric : undefined}>
                                {c.label}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {result.rows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                            {columns.map((c) => (
                                <td key={c.key} data-label={c.label} className={numeric(c.kind) ? styles.reportNumeric : undefined}>
                                    <CellValue column={c} value={row[c.key]} ctx={ctx} labels={labels} />
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function ResultView({ result }: { result: DynamicReportResult }) {
    const columns = useColumns(result);
    // Respuesta sencilla (una fila, pocas columnas) -> datos destacados; si no, tabla
    if (result.rows.length === 1 && columns.length <= 6) return <ResultSummary result={result} columns={columns} />;
    return <ResultTable result={result} columns={columns} />;
}

// Lo que cambia cómo leer el resultado queda a la vista (nombres interpretados, período, avisos); los
// detalles técnicos (zona, hora de la consulta, moneda, filas, nombres originales) van plegados
function Interpretation({ result }: { result: DynamicReportResult }) {
    const t = useTranslations('Reports.dynamic');
    const info = result.interpretation;
    if (!info) return null;
    const columns = result.columns.length > 0 ? result.columns : Object.keys(result.rows[0] ?? {});
    return (
        <div className={styles.reportNotes}>
            {info.entidades.length > 0 && (
                <div>
                    <Info size={12} aria-hidden="true" /> {t('view.interpreted')}:{' '}
                    {info.entidades.map((e, index) => (
                        <span key={`${e.tipo}-${e.texto}`}>
                            {index > 0 && ' · '}«{e.texto}» → {e.nombre}
                        </span>
                    ))}
                </div>
            )}
            {(info.periodo ?? []).map((periodo) => (
                <div key={periodo}>
                    <CalendarRange size={12} aria-hidden="true" /> {periodo}
                </div>
            ))}
            {info.avisos.map((aviso) => (
                <div key={aviso}>
                    <AlertTriangle size={12} aria-hidden="true" /> {aviso}
                </div>
            ))}
            <details className={styles.reportTechnical}>
                <summary>{t('view.technical')}</summary>
                <dl>
                    <dt>{t('view.timeZone')}</dt>
                    <dd>{info.zonaHoraria}</dd>
                    <dt>{t('view.queriedAt')}</dt>
                    <dd>{info.fechaHoraLocal}</dd>
                    <dt>{t('view.currency')}</dt>
                    <dd>{info.moneda}</dd>
                    {columns.length > 0 && (
                        <>
                            <dt>{t('view.originalColumns')}</dt>
                            <dd>
                                <code>{columns.join(', ')}</code>
                            </dd>
                        </>
                    )}
                </dl>
                <p>{t('rows', { count: result.rowCount })}</p>
            </details>
        </div>
    );
}

// Título del estado de una respuesta: cada caso se ve distinto para que un error nunca parezca
// "no hubo ventas" (y una consulta rechazada no parezca falta de permiso)
function StatusTitle({ kind, children }: { kind: 'noData' | 'clarification' | 'forbidden' | 'unanswerable' | 'rejected' | 'failed' | 'unavailable'; children?: React.ReactNode }) {
    const t = useTranslations('Reports.dynamic');
    const Icon = kind === 'noData' ? SearchX : kind === 'clarification' ? HelpCircle : kind === 'forbidden' ? Lock : AlertTriangle;
    return (
        <div className={['rejected', 'failed', 'unavailable'].includes(kind) ? `${styles.errorMessage} ${styles.chatError}` : styles.emptyState} role="status">
            <p>
                <Icon size={16} style={{ verticalAlign: 'text-bottom', marginRight: '0.35rem' }} aria-hidden="true" />
                <strong>{t(`status.${kind}`)}</strong>
            </p>
            {children}
        </div>
    );
}

function EntryCard({ entry, onAsk, disabled, viaVoice }: { entry: DynamicReportEntry; onAsk: (question: string) => void; disabled: boolean; viaVoice: boolean }) {
    const result = entry.result;
    const estado = result?.estado ?? (result && result.rowCount === 0 ? 'sin_datos' : 'ok');
    const clarification = result?.clarification;

    return (
        <div className={styles.tableCard}>
            <div className={styles.chatQuestion}>
                <div className={styles.chatQuestionText}>
                    <Sparkles size={16} />
                    <span>{entry.prompt}</span>
                </div>
                {result && estado === 'ok' && <ExportBar entry={entry} viaVoice={viaVoice} />}
            </div>

            {entry.error && (
                // Error: la consulta no se ejecutó o falló. Nunca se muestra como "sin datos"
                <StatusTitle kind={entry.errorKind ?? 'failed'}>
                    <p>{entry.error}</p>
                </StatusTitle>
            )}

            {estado === 'aclaracion' && clarification && (
                // Nombre ambiguo o inexistente: no se ejecutó nada. Cada opción vuelve a preguntar precisando el nombre
                <StatusTitle kind="clarification">
                    <p>{clarification.mensaje}</p>
                    <div className={styles.badgeList}>
                        {clarification.opciones.flatMap((group) =>
                            group.opciones.map((option) => (
                                <button
                                    key={`${group.tipo}-${group.texto}-${option}`}
                                    type="button"
                                    className={styles.chip}
                                    disabled={disabled}
                                    onClick={() => onAsk(`${entry.prompt} (${group.tipo}: ${option})`)}
                                >
                                    {option}
                                </button>
                            )),
                        )}
                    </div>
                </StatusTitle>
            )}

            {estado === 'sin_permiso' && clarification && (
                <StatusTitle kind="forbidden">
                    <p>{clarification.mensaje}</p>
                </StatusTitle>
            )}

            {estado === 'no_respondible' && <StatusTitle kind="unanswerable" />}

            {result && estado === 'sin_datos' && (
                <>
                    <StatusTitle kind="noData" />
                    {/* Con el período y la zona a la vista, "sin datos" se puede comprobar */}
                    <Interpretation result={result} />
                </>
            )}

            {result && estado === 'ok' && (
                <>
                    <ResultView result={result} />
                    {/* El SQL generado no se muestra al usuario final; queda solo en el log del backend (reports.service.ts) */}
                    <Interpretation result={result} />
                </>
            )}
        </div>
    );
}

export default function DynamicReportPanel() {
    const { entries, isLoading, ask } = useDynamicReport();
    const t = useTranslations('Reports.dynamic');
    const locale = useLocale();
    const examples = t.raw('examples') as string[];
    const [prompt, setPrompt] = useState('');
    // Preguntas que se dictaron: el informe exportado muestra 'Consulta por voz: "…"'
    const dictatedRef = useRef(false);
    const [voicePrompts, setVoicePrompts] = useState<Set<string>>(() => new Set());
    const onDictated = useCallback((text: string) => {
        dictatedRef.current = true;
        setPrompt(text);
    }, []);
    // Lo dictado va actualizando el mismo estado que el input; el usuario revisa y pulsa "Preguntar"
    // Dicta en el idioma elegido: el reconocimiento de voz del navegador necesita la etiqueta completa (es-BO, fr-FR…)
    const { isSupported, isListening, error: voiceError, toggle: toggleVoice } = useSpeechRecognition({ lang: intlLocale(locale), onText: onDictated });

    const submit = async (question: string) => {
        const text = question.trim();
        if (!text || isLoading || isListening) return;
        if (dictatedRef.current && text === prompt.trim()) setVoicePrompts((prev) => new Set(prev).add(text));
        dictatedRef.current = false;
        setPrompt('');
        await ask(text);
    };

    return (
        <div className={styles.page}>
            <div className={styles.tableCard}>
                <form
                    className={`${styles.form} ${styles.formCard}`}
                    onSubmit={(e) => {
                        e.preventDefault();
                        submit(prompt);
                    }}
                >
                    <div className={styles.field}>
                        <label htmlFor="ai-prompt">{t('promptLabel')}</label>
                        <div className={styles.chatInput}>
                            <input
                                id="ai-prompt"
                                className={`${styles.input} ${isLoading ? styles.inputLocked : ''}`}
                                value={prompt}
                                onChange={(e) => {
                                    // Si se borra todo y se escribe a mano, ya no es una consulta por voz
                                    if (!e.target.value.trim()) dictatedRef.current = false;
                                    setPrompt(e.target.value);
                                }}
                                maxLength={500}
                                placeholder={t('promptPlaceholder')}
                                disabled={isLoading}
                                // Mientras se dicta, el texto lo controla el micrófono
                                readOnly={isListening}
                            />
                            <button
                                type="button"
                                className={`${styles.micButton} ${isListening ? styles.micButtonActive : ''}`}
                                onClick={() => toggleVoice(prompt)}
                                disabled={!isSupported || isLoading}
                                aria-pressed={isListening}
                                aria-label={isListening ? t('stopDictation') : t('dictate')}
                                title={
                                    !isSupported
                                        ? t('dictationUnsupported')
                                        : isListening
                                          ? t('stopDictation')
                                          : t('dictateShort')
                                }
                            >
                                {isSupported ? <Mic size={18} /> : <MicOff size={18} />}
                            </button>
                            <button
                                type="submit"
                                className={`${styles.button} ${isLoading ? styles.loadingButton : ''}`}
                                disabled={!prompt.trim() || isLoading || isListening}
                                aria-busy={isLoading}
                            >
                                {isLoading ? (
                                    <>
                                        <Loader2 size={16} className={styles.spinner} aria-hidden="true" />
                                        {t('processing')}
                                    </>
                                ) : (
                                    <>
                                        <Send size={16} />
                                        {t('ask')}
                                    </>
                                )}
                            </button>
                        </div>
                        {isListening && <small className={styles.voiceListening}>{t('listening')}</small>}
                        {voiceError && <small className={styles.voiceError}>{voiceError}</small>}
                        {!isSupported && (
                            <small>{t('unsupportedHint')}</small>
                        )}
                        <small>{t('help')}</small>
                    </div>

                    <div className={styles.badgeList}>
                        {examples.map((example) => (
                            <button
                                key={example}
                                type="button"
                                className={styles.chip}
                                onClick={() => submit(example)}
                                disabled={isLoading}
                            >
                                {example}
                            </button>
                        ))}
                    </div>
                </form>
            </div>

            {isLoading && (
                <div className={styles.aiLoadingState} role="status" aria-live="polite">
                    <Loader2 size={18} className={styles.spinner} aria-hidden="true" />
                    <span>{t('analyzing')}</span>
                </div>
            )}

            {entries.map((entry) => (
                <EntryCard key={entry.id} entry={entry} onAsk={submit} disabled={isLoading || isListening} viaVoice={voicePrompts.has(entry.prompt)} />
            ))}
        </div>
    );
}
