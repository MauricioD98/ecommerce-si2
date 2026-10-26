'use client';

import React, { useState } from 'react';
import { FileDown, FileSpreadsheet, FileText, Loader2, Mic, MicOff, Send, Sparkles } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import styles from './admin-table.module.scss';
import { intlLocale } from '@/i18n/config';
import { DynamicReportEntry, useDynamicReport } from '@/hooks/useReports';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { DynamicReportResult } from '@/types/admin.types';

// Las columnas cambian según la pregunta: se muestran tal cual las devuelve la consulta
const formatCell = (value: unknown, locale: string): string => {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'number') return value.toLocaleString(intlLocale(locale), { maximumFractionDigits: 2 });
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
};

// Nombre de archivo a partir de la pregunta (sin tildes/símbolos, acotado)
function buildExportFilename(prompt: string, fallback: string): string {
    const slug = prompt
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-+|-+$)/g, '')
        .slice(0, 60);
    return `stella-femme-${slug || fallback}`;
}

// Filas con encabezados legibles (sin guiones bajos), en el orden que devolvió la consulta
function toPrettyRows(result: DynamicReportResult): Record<string, unknown>[] {
    return result.rows.map((row) => {
        const pretty: Record<string, unknown> = {};
        for (const column of result.columns) {
            pretty[column.replace(/_/g, ' ')] = row[column] ?? null;
        }
        return pretty;
    });
}

async function exportToExcel(result: DynamicReportResult, filename: string, sheetName: string) {
    const XLSX = await import('xlsx');
    const worksheet = XLSX.utils.json_to_sheet(toPrettyRows(result));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    XLSX.writeFile(workbook, `${filename}.xlsx`);
}

async function exportToCsv(result: DynamicReportResult, filename: string, sheetName: string) {
    const XLSX = await import('xlsx');
    const worksheet = XLSX.utils.json_to_sheet(toPrettyRows(result));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    XLSX.writeFile(workbook, `${filename}.csv`, { bookType: 'csv' });
}

async function exportToPdf(result: DynamicReportResult, filename: string, title: string, locale: string) {
    const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
    const doc = new jsPDF();

    doc.setFontSize(12);
    doc.text(title, 14, 15);

    autoTable(doc, {
        startY: 20,
        head: [result.columns.map((column) => column.replace(/_/g, ' '))],
        body: result.rows.map((row) => result.columns.map((column) => formatCell(row[column], locale))),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [0, 0, 0] },
    });

    doc.save(`${filename}.pdf`);
}

function ExportBar({ entry }: { entry: DynamicReportEntry }) {
    const result = entry.result;
    const disabled = !result || result.rows.length === 0;
    const t = useTranslations('Reports.dynamic');
    const locale = useLocale();
    const filename = buildExportFilename(entry.prompt, t('fileFallback'));

    return (
        <div className={styles.exportBar}>
            <button
                type="button"
                className={styles.exportButton}
                disabled={disabled}
                onClick={() => result && exportToPdf(result, filename, entry.prompt, locale)}
                title={t('exportPdf')}
            >
                <FileText size={14} />
                PDF
            </button>
            <button
                type="button"
                className={styles.exportButton}
                disabled={disabled}
                onClick={() => result && exportToExcel(result, filename, t('sheetName'))}
                title={t('exportExcel')}
            >
                <FileSpreadsheet size={14} />
                Excel
            </button>
            <button
                type="button"
                className={styles.exportButton}
                disabled={disabled}
                onClick={() => result && exportToCsv(result, filename, t('sheetName'))}
                title={t('exportCsv')}
            >
                <FileDown size={14} />
                CSV
            </button>
        </div>
    );
}

function ResultTable({ result }: { result: DynamicReportResult }) {
    const t = useTranslations('Reports.dynamic');
    const locale = useLocale();

    if (result.rows.length === 0) {
        return <div className={styles.emptyState}>{t('noResults')}</div>;
    }

    return (
        <div className={styles.tableWrapper}>
            <table className={styles.table}>
                <thead>
                    <tr>
                        {Object.keys(result.rows[0]).map((column) => (
                            <th key={column}>{column.replace(/_/g, ' ')}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {result.rows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                            {Object.values(row).map((value, cellIndex) => (
                                <td key={cellIndex}>{formatCell(value, locale)}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function EntryCard({ entry }: { entry: DynamicReportEntry }) {
    const t = useTranslations('Reports.dynamic');

    return (
        <div className={styles.tableCard}>
            <div className={styles.chatQuestion}>
                <div className={styles.chatQuestionText}>
                    <Sparkles size={16} />
                    <span>{entry.prompt}</span>
                </div>
                {entry.result && <ExportBar entry={entry} />}
            </div>

            {entry.error && <div className={`${styles.errorMessage} ${styles.chatError}`}>{entry.error}</div>}

            {entry.result && (
                <>
                    <ResultTable result={entry.result} />
                    {/* El SQL generado ya no se muestra al usuario final; queda solo en el log del backend (reports.service.ts) */}
                    <div className={styles.sqlDetails}>
                        {t('rows', { count: entry.result.rowCount })}
                    </div>
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
    // Lo dictado va actualizando el mismo estado que el input; el usuario revisa y pulsa "Preguntar"
    // Dicta en el idioma elegido: el reconocimiento de voz del navegador necesita la etiqueta completa (es-BO, fr-FR…)
    const { isSupported, isListening, error: voiceError, toggle: toggleVoice } = useSpeechRecognition({ lang: intlLocale(locale), onText: setPrompt });

    const submit = async (question: string) => {
        const text = question.trim();
        if (!text || isLoading || isListening) return;
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
                                onChange={(e) => setPrompt(e.target.value)}
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
                <EntryCard key={entry.id} entry={entry} />
            ))}
        </div>
    );
}
