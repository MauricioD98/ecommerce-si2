'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { LayoutDashboard, Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import styles from './admin-table.module.scss';
import GeneralMetrics from './GeneralMetrics';
import DynamicReportPanel from './DynamicReportPanel';
import SalesForecastPanel from './SalesForecastPanel';
import { useStorePlan } from '@/providers/StoreInfoProvider';
import { useAdminRole } from '@/hooks/useAdminAccess';

type Tab = 'metrics' | 'ai' | 'forecast';

export default function ReportsClient() {
    const [tab, setTab] = useState<Tab>('metrics');
    const t = useTranslations('Reports');
    const { features } = useStorePlan();
    const { isSuperAdmin } = useAdminRole();

    return (
        <div className={styles.page}>
            <div className={styles.pageHeader}>
                <div>
                    <h1>{t('title')}</h1>
                    <p>{t('subtitle')}</p>
                </div>
                <Link href="/admin/reports/dashboard" className={styles.button}>
                    <LayoutDashboard size={16} />
                    {t('openDashboard')}
                </Link>
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
                    {!features.aiReports && (
                        <span className={`${styles.badge} ${styles.badgeMuted}`} style={{ marginLeft: '0.5rem' }}>
                            Plan Pro
                        </span>
                    )}
                </button>
                <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'forecast'}
                    className={`${styles.tab} ${tab === 'forecast' ? styles.tabActive : ''}`}
                    onClick={() => setTab('forecast')}
                >
                    {t('tabForecast')}
                    {!features.aiReports && (
                        <span className={`${styles.badge} ${styles.badgeMuted}`} style={{ marginLeft: '0.5rem' }}>
                            Plan Pro
                        </span>
                    )}
                </button>
            </div>

            {tab === 'metrics' ? (
                <GeneralMetrics />
            ) : tab === 'forecast' ? (
                features.aiReports ? (
                    <SalesForecastPanel />
                ) : (
                    <div className={`${styles.tableCard} ${styles.emptyState}`}>
                        <Lock size={22} style={{ margin: '0 auto 0.5rem', opacity: 0.7 }} />
                        <p>{t('forecast.planLocked')}</p>
                    </div>
                )
            ) : features.aiReports ? (
                <DynamicReportPanel />
            ) : (
                <div className={styles.tableCard} style={{ padding: '2rem', textAlign: 'center' }}>
                    <Lock size={28} style={{ margin: '0 auto 0.75rem', opacity: 0.7 }} />
                    <h2 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                        Reportes con IA disponibles en el Plan Pro
                    </h2>
                    <p style={{ color: 'var(--muted-foreground)', marginBottom: '1.25rem' }}>
                        Tu tienda está en el <strong>Plan {features.planName}</strong>. Mejora al Plan Pro para generar reportes dinámicos con lenguaje natural e inteligencia artificial.
                    </p>
                    {isSuperAdmin && (
                        <Link href="/admin/suscripcion" className={styles.button}>
                            Mejorar a Plan Pro
                        </Link>
                    )}
                </div>
            )}
        </div>
    );
}
