'use client';

import React, { useState } from 'react';
import { Loader2, Mic, MicOff, Send, Sparkles } from 'lucide-react';
import styles from './admin-table.module.scss';
import { DynamicReportEntry, useDynamicReport } from '@/hooks/useReports';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { DynamicReportResult } from '@/types/admin.types';

const EXAMPLES = [
    '¿Cuáles son los 5 productos más vendidos?',
    'Ingresos por mes',
    'Cantidad de pedidos por tipo de entrega',
    '¿Qué clientes han comprado más?',
];

// Las columnas cambian según la pregunta: se muestran tal cual las devuelve la consulta
const formatCell = (value: unknown): string => {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'number') return value.toLocaleString('es-BO', { maximumFractionDigits: 2 });
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
};

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
                <Sparkles size={16} />
                <span>{entry.prompt}</span>
            </div>

            {entry.error && <div className={`${styles.errorMessage} ${styles.chatError}`}>{entry.error}</div>}

            {entry.result && (
                <>
                    <ResultTable result={entry.result} />
                    <details className={styles.sqlDetails}>
                        <summary>
                            {entry.result.rowCount} {entry.result.rowCount === 1 ? 'fila' : 'filas'} · ver consulta SQL
                        </summary>
                        <pre>{entry.result.sql}</pre>
                    </details>
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
                        <small>La IA solo puede leer datos: no puede modificar nada. Verás la consulta SQL que se ejecutó.</small>
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
