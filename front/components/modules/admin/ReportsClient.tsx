'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import styles from './admin-table.module.scss';
import GeneralMetrics from './GeneralMetrics';
import DynamicReportPanel from './DynamicReportPanel';

type Tab = 'metrics' | 'ai';

export default function ReportsClient() {
    const [tab, setTab] = useState<Tab>('metrics');
    const t = useTranslations('Reports');

    return (
        <div className={styles.page}>
            <div className={styles.pageHeader}>
                <div>
                    <h1>{t('title')}</h1>
                    <p>{t('subtitle')}</p>
                </div>
            </div>

            <div className={styles.tabs} role="tablist" aria-label={t('tabsLabel')}>
                <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'metrics'}
                    className={`${styles.tab} ${tab === 'metrics' ? styles.tabActive : ''}`}
                    onClick={() => setTab('metrics')}
                >
                    {t('tabMetrics')}
                </button>
                <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'ai'}
                    className={`${styles.tab} ${tab === 'ai' ? styles.tabActive : ''}`}
                    onClick={() => setTab('ai')}
                >
                    {t('tabDynamic')}
                </button>
            </div>

            {tab === 'metrics' ? <GeneralMetrics /> : <DynamicReportPanel />}
        </div>
    );
}
