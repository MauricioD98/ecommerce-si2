'use client';

import React, { useState } from 'react';
import { FileDown, FileSpreadsheet, FileText, Loader2, Mic, MicOff, Send, Sparkles } from 'lucide-react';
import styles from './admin-table.module.scss';
import { DynamicReportEntry, useDynamicReport } from '@/hooks/useReports';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { DynamicReportResult } from '@/types/admin.types';

const EXAMPLES = [
    '¿Cuál fue el ingreso total por sucursal esta semana?',
    'Los 10 productos con menor stock en almacén',
    'Rendimiento de ventas por cajero este mes',
    'Comparativa de cantidad de ventas Web vs POS físico',
    'Clientes con más compras registradas',
];

// Las columnas cambian según la pregunta: se muestran tal cual las devuelve la consulta
const formatCell = (value: unknown): string => {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'number') return value.toLocaleString('es-BO', { maximumFractionDigits: 2 });
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
};

// Nombre de archivo a partir de la pregunta (sin tildes/símbolos, acotado)
function buildExportFilename(prompt: string): string {
    const slug = prompt
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-+|-+$)/g, '')
        .slice(0, 60);
    return `stella-femme-${slug || 'reporte'}`;
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

async function exportToExcel(result: DynamicReportResult, filename: string) {
    const XLSX = await import('xlsx');
    const worksheet = XLSX.utils.json_to_sheet(toPrettyRows(result));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Reporte');
    XLSX.writeFile(workbook, `${filename}.xlsx`);
}

async function exportToCsv(result: DynamicReportResult, filename: string) {
    const XLSX = await import('xlsx');
    const worksheet = XLSX.utils.json_to_sheet(toPrettyRows(result));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Reporte');
    XLSX.writeFile(workbook, `${filename}.csv`, { bookType: 'csv' });
}

async function exportToPdf(result: DynamicReportResult, filename: string, title: string) {
    const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
    const doc = new jsPDF();

    doc.setFontSize(12);
    doc.text(title, 14, 15);

    autoTable(doc, {
        startY: 20,
        head: [result.columns.map((column) => column.replace(/_/g, ' '))],
        body: result.rows.map((row) => result.columns.map((column) => formatCell(row[column]))),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [0, 0, 0] },
    });

    doc.save(`${filename}.pdf`);
}

function ExportBar({ entry }: { entry: DynamicReportEntry }) {
    const result = entry.result;
    const disabled = !result || result.rows.length === 0;
    const filename = buildExportFilename(entry.prompt);

    return (
        <div className={styles.exportBar}>
            <button
                type="button"
                className={styles.exportButton}
                disabled={disabled}
                onClick={() => result && exportToPdf(result, filename, entry.prompt)}
                title="Exportar a PDF"
            >
                <FileText size={14} />
                PDF
            </button>
            <button
                type="button"
                className={styles.exportButton}
                disabled={disabled}
                onClick={() => result && exportToExcel(result, filename)}
                title="Exportar a Excel"
            >
                <FileSpreadsheet size={14} />
                Excel
            </button>
            <button
                type="button"
                className={styles.exportButton}
                disabled={disabled}
                onClick={() => result && exportToCsv(result, filename)}
                title="Exportar a CSV"
            >
                <FileDown size={14} />
                CSV
            </button>
        </div>
    );
}

function ResultTable({ result }: { result: DynamicReportResult }) {
    if (result.rows.length === 0) {
        return <div className={styles.emptyState}>La consulta no devolvió resultados.</div>;
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
                                <td key={cellIndex}>{formatCell(value)}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function EntryCard({ entry }: { entry: DynamicReportEntry }) {
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
                        {entry.result.rowCount} {entry.result.rowCount === 1 ? 'fila' : 'filas'}
                    </div>
                </>
            )}
        </div>
    );
}

export default function DynamicReportPanel() {
    const { entries, isLoading, ask } = useDynamicReport();
    const [prompt, setPrompt] = useState('');
    // Lo dictado va actualizando el mismo estado que el input; el usuario revisa y pulsa "Preguntar"
    const { isSupported, isListening, error: voiceError, toggle: toggleVoice } = useSpeechRecognition({ onText: setPrompt });

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
                        <label htmlFor="ai-prompt">Pregunta en lenguaje natural</label>
                        <div className={styles.chatInput}>
                            <input
                                id="ai-prompt"
                                className={`${styles.input} ${isLoading ? styles.inputLocked : ''}`}
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                maxLength={500}
                                placeholder="Ej. ¿Cuánto vendimos por sucursal este mes?"
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
                                aria-label={isListening ? 'Detener dictado' : 'Dictar la pregunta por voz'}
                                title={
                                    !isSupported
                                        ? 'Tu navegador no permite el dictado por voz'
                                        : isListening
                                          ? 'Detener dictado'
                                          : 'Dictar por voz'
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
                                        Procesando...
                                    </>
                                ) : (
                                    <>
                                        <Send size={16} />
                                        Preguntar
                                    </>
                                )}
                            </button>
                        </div>
                        {isListening && <small className={styles.voiceListening}>Escuchando... habla ahora y pulsa el micrófono para terminar.</small>}
                        {voiceError && <small className={styles.voiceError}>{voiceError}</small>}
                        {!isSupported && (
                            <small>El dictado por voz no está disponible en este navegador (usa Chrome, Edge o Safari).</small>
                        )}
                        <small>
                            Usa tu voz o escribe para generar consultas analíticas en tiempo real sobre las ventas, inventario y
                            rendimiento de la tienda.
                        </small>
                    </div>

                    <div className={styles.badgeList}>
                        {EXAMPLES.map((example) => (
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
                    <span>Analizando datos y generando reporte...</span>
                </div>
            )}

            {entries.map((entry) => (
                <EntryCard key={entry.id} entry={entry} />
            ))}
        </div>
    );
}
