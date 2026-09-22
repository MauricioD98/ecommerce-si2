'use client';

import React, { useState } from 'react';
import styles from './admin-table.module.scss';
import GeneralMetrics from './GeneralMetrics';
import DynamicReportPanel from './DynamicReportPanel';

type Tab = 'metrics' | 'ai';

export default function ReportsClient() {
    const [tab, setTab] = useState<Tab>('metrics');

    return (
        <div className={styles.page}>
            <div className={styles.pageHeader}>
                <div>
                    <h1>Reportes</h1>
                    <p>Métricas de ventas y consultas en lenguaje natural sobre tus datos.</p>
                </div>
            </div>

            <div className={styles.tabs} role="tablist" aria-label="Tipo de reporte">
                <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'metrics'}
                    className={`${styles.tab} ${tab === 'metrics' ? styles.tabActive : ''}`}
                    onClick={() => setTab('metrics')}
                >
                    Métricas Generales
                </button>
                <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'ai'}
                    className={`${styles.tab} ${tab === 'ai' ? styles.tabActive : ''}`}
                    onClick={() => setTab('ai')}
                >
                    Pregúntale a la IA
                </button>
            </div>

            {tab === 'metrics' ? <GeneralMetrics /> : <DynamicReportPanel />}
        </div>
    );
}
