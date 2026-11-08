'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, CreditCard, DatabaseBackup, RefreshCw, Store } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import tableStyles from '@/components/modules/admin/admin-table.module.scss';
import styles from './platform-admin.module.scss';
import { intlLocale } from '@/i18n/config';
import type { PlatformMetrics, PlatformTenant } from '@/service/api/platformAdmin.service';
import type { BackupJob } from '@/types/backup.types';
import { usePlatformAdmin } from './PlatformAdminContext';

// Inicio del panel del SaaS. Solo muestra lo que devuelve la API:
//   - GET /platform/tenants/metrics → conteos por estado, suscripciones y MRR estimado
//   - GET /platform/tenants         → nombres de las tiendas que requieren atención
//   - GET /platform/backups(+config) → últimos respaldos
// Todo sale del plano de control: ninguna de estas consultas entra al schema de cada tienda.
//
// Cada cifra distingue tres casos:
//   - un número (también 0): el dato existe y vale eso
//   - "Sin datos": la consulta funcionó pero no hay nada que contar todavía (p. ej. ninguna tienda
//     tiene suscripción de Stripe, así que no hay MRR que calcular)
//   - "No disponible": el dato no se pudo obtener (API anterior sin el campo, precio de Stripe ilegible,
//     respaldos sin configurar)

type StatValue = number | string | 'noData' | 'unavailable';

const PAYMENT_ISSUE_STATUSES = new Set(['past_due', 'unpaid', 'incomplete']);
const RECENT_BACKUPS = 5;

function Stat({ label, value, hint }: { label: string; value: StatValue; hint?: string }) {
    const t = useTranslations('PlatformAdmin.home');
    const missing = value === 'noData' || value === 'unavailable';
    return (
        <div className={tableStyles.statCard}>
            <span className={tableStyles.statLabel}>{label}</span>
            {missing ? (
                <span className={styles.statMissing}>{value === 'noData' ? t('noData') : t('unavailable')}</span>
            ) : (
                <span className={tableStyles.statValue}>{value}</span>
            )}
            {hint && <span className={tableStyles.cellSub}>{hint}</span>}
        </div>
    );
}

export default function PlatformHomeSection() {
    const t = useTranslations('PlatformAdmin');
    const tb = useTranslations('Backups');
    const tSub = useTranslations('AdminSubscription');
    const locale = useLocale();
    const { metrics, tenants, isLoading, error, reload, loadedAt, backupOverview, loadBackupOverview } = usePlatformAdmin();

    // Respaldos: se piden al abrir Inicio solo si todavía no están (o si "Actualizar" los invalidó)
    useEffect(() => {
        if (backupOverview.status === 'idle') loadBackupOverview();
    }, [backupOverview.status, loadBackupOverview]);

    const subscriptionLabel = (status: string) =>
        ['past_due', 'unpaid', 'incomplete'].includes(status) ? tSub(`statuses.${status as 'past_due'}`) : status;
    const formatDateTime = (value: string | Date) =>
        new Date(value).toLocaleString(intlLocale(locale), { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const formatTime = (value: Date) => value.toLocaleTimeString(intlLocale(locale), { hour: '2-digit', minute: '2-digit' });
    const formatMoney = (value: number, currency: string) =>
        new Intl.NumberFormat(intlLocale(locale), { style: 'currency', currency }).format(value);

    const header = (
        <div className={tableStyles.pageHeader}>
            <div>
                <h1>{t('home.title')}</h1>
                <p>{t('home.subtitle')}</p>
            </div>
            {loadedAt && <span className={tableStyles.cellSub}>{t('home.updatedAt', { time: formatTime(loadedAt) })}</span>}
        </div>
    );

    // ------------------------------------------------------------------ Carga inicial / error
    if (!metrics) {
        return (
            <div className={tableStyles.page}>
                {header}
                {error && !isLoading ? (
                    <section className={styles.stateCard} role="alert">
                        <AlertTriangle size={20} aria-hidden />
                        <div>
                            <h2>{t('home.errorTitle')}</h2>
                            <p>{error}</p>
                        </div>
                        <button type="button" className={tableStyles.buttonSecondary} onClick={() => reload()}>
                            <RefreshCw size={16} aria-hidden />
                            {t('home.retry')}
                        </button>
                    </section>
                ) : (
                    <div className={tableStyles.loadingState} aria-busy="true">
                        {t('home.loading')}
                    </div>
                )}
            </div>
        );
    }

    const attentionTenants = tenants.filter((tenant) => tenant.status === 'FAILED' || tenant.status === 'PROVISIONING');
    const paymentIssueTenants = tenants.filter((tenant) => tenant.subscriptionStatus && PAYMENT_ISSUE_STATUSES.has(tenant.subscriptionStatus));
    const failedSignups = metrics.failedSignups;

    return (
        <div className={tableStyles.page}>
            {header}

            {metrics.total === 0 ? (
                <section className={styles.stateCard}>
                    <Store size={20} aria-hidden />
                    <div>
                        <h2>{t('home.emptyTitle')}</h2>
                        <p>{t('home.emptyText')}</p>
                    </div>
                </section>
            ) : (
                <>
                    {storeStats(metrics, metrics.failed + metrics.provisioning + (failedSignups ?? 0))}
                    {subscriptionStats(metrics)}
                </>
            )}

            {/* ------------------------------------------------ Requieren atención */}
            <section className={styles.panel} aria-labelledby="platform-attention">
                <h2 id="platform-attention">{t('home.attentionTitle')}</h2>
                {attentionTenants.length === 0 && paymentIssueTenants.length === 0 && !failedSignups ? (
                    <p className={tableStyles.cellSub}>{metrics.total === 0 ? t('home.noData') : t('home.attentionEmpty')}</p>
                ) : (
                    <ul className={styles.attentionList}>
                        {attentionTenants.map((tenant) => (
                            attentionRow(tenant.id, tenant, t(`statuses.${tenant.status}`), tenant.provisionError)
                        ))}
                        {paymentIssueTenants.map((tenant) => (
                            attentionRow(`pay-${tenant.id}`, tenant, t('home.attention.paymentIssue', { status: subscriptionLabel(tenant.subscriptionStatus ?? '') }))
                        ))}
                        {!!failedSignups && (
                            <li>
                                <div className={tableStyles.cellMain}>
                                    <span className={tableStyles.cellTitle}>{t('home.attention.failedSignups', { count: failedSignups })}</span>
                                    <span className={tableStyles.cellSub}>{t('home.attention.failedSignupsHint')}</span>
                                </div>
                            </li>
                        )}
                    </ul>
                )}
                {failedSignups === undefined && <p className={tableStyles.cellSub}>{t('home.attention.signupsUnavailable')}</p>}
            </section>

            {/* ------------------------------------------------ Últimos respaldos */}
            <section className={styles.panel} aria-labelledby="platform-backups">
                <h2 id="platform-backups">{t('home.backups.title')}</h2>
                {backupSummary()}
            </section>

            {/* ------------------------------------------------ Accesos directos */}
            <section className={styles.panel} aria-labelledby="platform-shortcuts">
                <h2 id="platform-shortcuts">{t('home.shortcutsTitle')}</h2>
                <ul className={styles.sectionGrid}>
                    <Shortcut href="/plataforma/tiendas" icon={<Store size={18} aria-hidden />} title={t('nav.stores')} text={t('sections.stores.summary')} />
                    <Shortcut
                        href="/plataforma/planes"
                        icon={<CreditCard size={18} aria-hidden />}
                        title={t('nav.plans')}
                        text={t('sections.plans.summary')}
                    />
                    <Shortcut href="/plataforma/respaldos" icon={<DatabaseBackup size={18} aria-hidden />} title={t('nav.backups')} text={t('sections.backups.summary')} />
                </ul>
            </section>
        </div>
    );

    // ------------------------------------------------------------------ Bloques

    function storeStats(m: PlatformMetrics, attentionTotal: number) {
        return (
            <section aria-labelledby="platform-stores-stats" className={styles.statSection}>
                <h2 id="platform-stores-stats" className={styles.statSectionTitle}>
                    {t('nav.stores')}
                </h2>
                <div className={tableStyles.statGrid}>
                    <Stat label={t('home.stats.total')} value={m.total} />
                    <Stat label={t('kpi.active')} value={m.active} hint={t('kpi.activeHint', { total: m.total })} />
                    <Stat label={t('kpi.suspended')} value={m.suspended} hint={t('kpi.suspendedHint')} />
                    <Stat
                        label={t('kpi.attention')}
                        value={attentionTotal}
                        hint={
                            m.failedSignups === undefined
                                ? t('kpi.attentionHint', { failed: m.failed, provisioning: m.provisioning })
                                : t('home.stats.attentionHint', { failed: m.failed, provisioning: m.provisioning, signups: m.failedSignups })
                        }
                    />
                </div>
            </section>
        );
    }

    function subscriptionStats(m: PlatformMetrics) {
        const s = m.subscriptions;
        // Ninguna tienda tiene suscripción de Stripe: no hay nada que contar (no es lo mismo que 0 activas)
        const none = s ? s.withSubscription === 0 : false;

        let mrrValue: StatValue;
        let mrrHint: string;
        if (!m.mrrStatus || m.mrrStatus === 'unavailable') {
            mrrValue = 'unavailable';
            mrrHint = m.mrrStatus ? t('home.stats.mrrUnavailable') : t('home.stats.fieldUnavailable');
        } else if (m.payingTenants === 0) {
            mrrValue = 'noData';
            mrrHint = t('home.stats.mrrNoPaying');
        } else {
            mrrValue = formatMoney(m.mrr, m.currency);
            mrrHint =
                m.mrrStatus === 'partial'
                    ? t('home.stats.mrrPartial', { count: m.unpricedTenants ?? 0 })
                    : t('kpi.mrrHint', { count: m.payingTenants });
        }

        return (
            <section aria-labelledby="platform-subs-stats" className={styles.statSection}>
                <h2 id="platform-subs-stats" className={styles.statSectionTitle}>
                    {t('home.stats.subscriptionsTitle')}
                </h2>
                <div className={tableStyles.statGrid}>
                    <Stat
                        label={t('home.stats.subsActive')}
                        value={!s ? 'unavailable' : none ? 'noData' : s.active}
                        hint={
                            !s
                                ? t('home.stats.fieldUnavailable')
                                : none
                                  ? t('home.stats.noSubscriptions', { count: s.withoutSubscription })
                                  : t('home.stats.subsActiveHint', { trialing: s.trialing, total: s.withSubscription })
                        }
                    />
                    <Stat
                        label={t('home.stats.paymentIssues')}
                        value={!s ? 'unavailable' : none ? 'noData' : s.paymentIssues}
                        hint={!s ? t('home.stats.fieldUnavailable') : t('home.stats.paymentIssuesHint')}
                    />
                    <Stat
                        label={t('home.stats.withoutSubscription')}
                        value={!s ? 'unavailable' : s.withoutSubscription}
                        hint={!s ? t('home.stats.fieldUnavailable') : t('home.stats.withoutSubscriptionHint')}
                    />
                    <Stat label={t('home.stats.mrrLabel')} value={mrrValue} hint={mrrHint} />
                </div>
                <p className={tableStyles.cellSub}>{t('home.stats.mrrExplain')}</p>
                {s && !none && s.ended + s.paused + s.otherStatus > 0 && (
                    <p className={tableStyles.cellSub}>
                        {t('home.stats.otherSubscriptions', { ended: s.ended, paused: s.paused, other: s.otherStatus })}
                    </p>
                )}
            </section>
        );
    }

    function attentionRow(key: string, tenant: PlatformTenant, reason: string, detail?: string | null) {
        return (
            <li key={key}>
                <div className={tableStyles.cellMain}>
                    <span className={tableStyles.cellTitle}>{tenant.name}</span>
                    <span className={tableStyles.cellSub}>
                        {reason} · {tenant.domain ?? tenant.slug}
                    </span>
                    {detail && (
                        <span className={tableStyles.rowError} title={detail}>
                            {detail.slice(0, 120)}
                        </span>
                    )}
                </div>
            </li>
        );
    }

    function backupSummary() {
        const when = formatDateTime;
        // Copia local: TypeScript no conserva el estrechamiento del tipo dentro de una función anidada
        const overview = backupOverview;
        if (overview.status === 'idle' || overview.status === 'loading') {
            return <p className={tableStyles.cellSub} aria-busy="true">{t('home.backups.loading')}</p>;
        }
        if (overview.status === 'error') {
            return (
                <div className={styles.inlineError} role="alert">
                    <span>{t('home.backups.unavailable', { reason: overview.message })}</span>
                    <button type="button" className={tableStyles.buttonSecondary} onClick={() => loadBackupOverview()}>
                        <RefreshCw size={14} aria-hidden />
                        {t('home.retry')}
                    </button>
                </div>
            );
        }

        const { config, jobs } = overview;
        const backups = jobs.filter((job) => job.kind === 'BACKUP');
        const lastOk = backups.find((job) => job.status === 'AVAILABLE');
        const lastPlatformOk = backups.find((job) => job.status === 'AVAILABLE' && job.scope === 'PLATFORM');
        const recent = jobs.slice(0, RECENT_BACKUPS);

        return (
            <>
                {!config.available && <p className={styles.inlineNotice}>{tb('notConfigured')}</p>}
                {jobs.length === 0 ? (
                    <p className={tableStyles.cellSub}>{t('home.backups.empty')}</p>
                ) : (
                    <>
                        <dl className={styles.factList}>
                            <div>
                                <dt>{t('home.backups.lastOk')}</dt>
                                <dd>{lastOk ? `${when(lastOk.createdAt)} · ${backupTarget(lastOk)}` : t('home.backups.noneOk')}</dd>
                            </div>
                            <div>
                                <dt>{t('home.backups.lastPlatform')}</dt>
                                <dd>{lastPlatformOk ? when(lastPlatformOk.createdAt) : t('home.backups.noneOk')}</dd>
                            </div>
                        </dl>
                        <ul className={styles.attentionList}>
                            {recent.map((job) => (
                                <li key={job.id} className={styles.jobRow}>
                                    <div className={tableStyles.cellMain}>
                                        <span className={tableStyles.cellTitle}>
                                            {tb(`kind.${job.kind}`)} · {backupTarget(job)}
                                        </span>
                                        <span className={tableStyles.cellSub}>{when(job.createdAt)}</span>
                                    </div>
                                    <span className={`${tableStyles.badge} ${job.status === 'FAILED' ? tableStyles.badgeDanger : tableStyles.badgeMuted}`}>
                                        {tb(`status.${job.status}`)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                        {jobs.length > RECENT_BACKUPS && (
                            <p className={tableStyles.cellSub}>{t('home.backups.more', { count: RECENT_BACKUPS })}</p>
                        )}
                    </>
                )}
                <Link href="/plataforma/respaldos" className={styles.panelLink}>
                    {t('home.backups.goTo')}
                    <ArrowRight size={16} aria-hidden />
                </Link>
            </>
        );
    }

    function backupTarget(job: BackupJob): string {
        return job.scope === 'PLATFORM' ? tb('allStores') : (job.tenantName ?? job.tenantSlug ?? job.tenantId ?? '—');
    }
}

function Shortcut({ href, icon, title, text, pending }: { href: string; icon: React.ReactNode; title: string; text: string; pending?: string }) {
    return (
        <li>
            <Link href={href} className={styles.sectionCard}>
                <span className={styles.sectionCardHead}>
                    {icon}
                    <strong>{title}</strong>
                    {pending && <span className={styles.navPending}>{pending}</span>}
                </span>
                <span className={tableStyles.cellSub}>{text}</span>
            </Link>
        </li>
    );
}
