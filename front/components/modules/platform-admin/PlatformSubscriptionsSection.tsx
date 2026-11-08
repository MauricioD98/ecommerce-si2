'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import tableStyles from '@/components/modules/admin/admin-table.module.scss';
import styles from './platform-admin.module.scss';
import { intlLocale } from '@/i18n/config';
import {
    PlatformApiError,
    type PlatformPlanPrice,
    type PlatformTenantSubscription,
    platformAdminService,
} from '@/service/api/platformAdmin.service';
import { usePlatformAdmin } from './PlatformAdminContext';
import { KNOWN_SUBSCRIPTION_STATUSES, PLAN_BADGE, PLAN_NAMES, SUBSCRIPTION_BADGE, normalizePlan } from './tenantDisplay';

// Planes y suscripciones del SaaS (supervisión). Los datos de cada suscripción son los que guardan los
// webhooks de Stripe en public.tenants (la vista no consulta Stripe por cada tienda). "Leer de Stripe"
// relee UNA suscripción ya vinculada: no crea, cambia ni cancela nada en Stripe.

const PAYMENT_ISSUES = new Set(['past_due', 'unpaid', 'incomplete']);
const ENDED = new Set(['canceled', 'incomplete_expired']);

type Group = '' | 'active' | 'trialing' | 'payment' | 'cancelScheduled' | 'ended' | 'none' | 'unsynced';
const GROUPS: Exclude<Group, ''>[] = ['active', 'trialing', 'payment', 'cancelScheduled', 'ended', 'none', 'unsynced'];

const isCancelScheduled = (s: PlatformTenantSubscription) =>
    !!s.subscriptionStatus && !ENDED.has(s.subscriptionStatus) && (s.cancelAtPeriodEnd || !!s.cancelAt);

function groupsOf(s: PlatformTenantSubscription): Exclude<Group, ''>[] {
    if (!s.hasSubscription) return ['none'];
    const groups: Exclude<Group, ''>[] = [];
    if (!s.subscriptionSyncedAt) groups.push('unsynced');
    if (s.subscriptionStatus === 'active') groups.push('active');
    if (s.subscriptionStatus === 'trialing') groups.push('trialing');
    if (s.subscriptionStatus && PAYMENT_ISSUES.has(s.subscriptionStatus)) groups.push('payment');
    if (isCancelScheduled(s)) groups.push('cancelScheduled');
    if (s.subscriptionStatus && ENDED.has(s.subscriptionStatus)) groups.push('ended');
    return groups;
}

type LoadState =
    | { status: 'loading' }
    | { status: 'ready'; rows: PlatformTenantSubscription[]; prices: PlatformPlanPrice[] | null }
    | { status: 'error'; message: string; missingApi: boolean };

export default function PlatformSubscriptionsSection() {
    const t = useTranslations('PlatformAdmin');
    const tSub = useTranslations('AdminSubscription');
    const locale = useLocale();
    const router = useRouter();
    const pathname = usePathname();
    const params = useSearchParams();
    const { token, metrics, loadedAt, reportError } = usePlatformAdmin();

    const [state, setState] = useState<LoadState>({ status: 'loading' });
    const [notice, setNotice] = useState<string | null>(null);
    const [syncTarget, setSyncTarget] = useState<PlatformTenantSubscription | null>(null);
    const [syncing, setSyncing] = useState(false);
    const [syncError, setSyncError] = useState<string | null>(null);

    const [filters, setFilters] = useState(() => {
        const grupo = params.get('estado') as Group | null;
        return {
            q: params.get('q') ?? '',
            estado: (grupo && (GROUPS as string[]).includes(grupo) ? grupo : '') as Group,
            plan: normalizePlan(params.get('plan')),
        };
    });
    const query = useMemo(() => {
        const next = new URLSearchParams();
        if (filters.q) next.set('q', filters.q);
        if (filters.estado) next.set('estado', filters.estado);
        if (filters.plan) next.set('plan', filters.plan);
        return next.toString();
    }, [filters]);
    useEffect(() => {
        if (query !== params.toString()) router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
        // Solo cuando cambian los filtros (params cambia como consecuencia de este replace)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query]);

    const load = useCallback(async () => {
        if (!token) return;
        try {
            // El catálogo es un extra: si Stripe no responde, la lista de suscripciones se muestra igual
            const [rows, prices] = await Promise.all([
                platformAdminService.getSubscriptions(token),
                platformAdminService.getPlanPrices(token).catch(() => null),
            ]);
            setState({ status: 'ready', rows, prices });
        } catch (err) {
            if (err instanceof PlatformApiError && err.status === 401) return reportError(err, t('loadFailed'));
            setState({
                status: 'error',
                message: err instanceof Error && err.message ? err.message : t('plans.loadFailed'),
                // 404: la API en ejecución todavía no tiene esta ruta (versión anterior)
                missingApi: err instanceof PlatformApiError && err.status === 404,
            });
        }
    }, [token, reportError, t]);

    // Solo plano de control: se vuelve a pedir cuando el panel recarga (botón "Actualizar")
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        load();
    }, [load, loadedAt]);

    const planLabel = (plan: string) => {
        const key = normalizePlan(plan);
        if (PLAN_NAMES[key]) return PLAN_NAMES[key];
        if (key === 'free' || key === 'legacy') return t(`tenants.plans.${key}`);
        return plan || t('tenants.plans.none');
    };
    const subLabel = (status: string) =>
        (KNOWN_SUBSCRIPTION_STATUSES as string[]).includes(status) ? tSub(`statuses.${status as 'active'}`) : status;
    const formatDate = (value: string) =>
        new Date(value).toLocaleDateString(intlLocale(locale), { day: '2-digit', month: 'short', year: 'numeric' });
    const formatDateTime = (value: string) =>
        new Date(value).toLocaleString(intlLocale(locale), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    const formatMoney = (amount: number, currency: string) =>
        new Intl.NumberFormat(intlLocale(locale), { style: 'currency', currency }).format(amount);

    const rows = useMemo(() => (state.status === 'ready' ? state.rows : []), [state]);
    const visible = useMemo(() => {
        const term = filters.q.trim().toLowerCase();
        return rows.filter(
            (row) =>
                (!filters.estado || groupsOf(row).includes(filters.estado)) &&
                (!filters.plan || normalizePlan(row.plan) === filters.plan) &&
                (!term || [row.name, row.slug, row.id].some((value) => value.toLowerCase().includes(term))),
        );
    }, [rows, filters]);
    const count = (group: Exclude<Group, ''>) => rows.filter((row) => groupsOf(row).includes(group)).length;
    const attention = rows.filter(
        (row) =>
            row.hasSubscription &&
            ((row.subscriptionStatus && PAYMENT_ISSUES.has(row.subscriptionStatus)) || row.priceRecognized === false),
    );
    const planOptions = useMemo(() => Array.from(new Set(rows.map((row) => normalizePlan(row.plan)))).sort(), [rows]);

    // Columna "Renovación / fin": solo con datos sincronizados, nunca un valor supuesto
    const periodCell = (row: PlatformTenantSubscription) => {
        if (!row.hasSubscription) return <span className={tableStyles.cellSub}>—</span>;
        if (!row.subscriptionSyncedAt) return <span className={tableStyles.cellSub}>{t('home.noData')}</span>;
        if (row.subscriptionEndedAt) return t('plans.endedOn', { date: formatDate(row.subscriptionEndedAt) });
        if (isCancelScheduled(row)) {
            const date = row.cancelAt ?? row.currentPeriodEnd;
            return <strong>{date ? t('plans.cancelsOn', { date: formatDate(date) }) : t('plans.cancelScheduled')}</strong>;
        }
        if (row.currentPeriodEnd && (row.subscriptionStatus === 'active' || row.subscriptionStatus === 'trialing'))
            return t('plans.renewsOn', { date: formatDate(row.currentPeriodEnd) });
        if (row.currentPeriodEnd) return t('plans.periodEnds', { date: formatDate(row.currentPeriodEnd) });
        return <span className={tableStyles.cellSub}>{t('home.noData')}</span>;
    };

    const confirmSync = async () => {
        if (!syncTarget) return;
        setSyncing(true);
        setSyncError(null);
        try {
            await platformAdminService.syncSubscription(token, syncTarget.id);
            setNotice(t('plans.sync.done', { name: syncTarget.name }));
            setSyncTarget(null);
            await load();
        } catch (err) {
            if (err instanceof PlatformApiError && err.status === 401) return reportError(err, t('actionFailed'));
            setSyncError(err instanceof Error && err.message ? err.message : t('actionFailed'));
        } finally {
            setSyncing(false);
        }
    };

    // ------------------------------------------------------------------ Estados de pantalla
    const header = (
        <div className={tableStyles.pageHeader}>
            <div>
                <h1>{t('nav.plans')}</h1>
                <p>{t('plans.subtitle')}</p>
            </div>
        </div>
    );
    if (state.status === 'loading') {
        return (
            <div className={tableStyles.page}>
                {header}
                <div className={tableStyles.loadingState} aria-busy="true">
                    {t('plans.loading')}
                </div>
            </div>
        );
    }
    if (state.status === 'error') {
        return (
            <div className={tableStyles.page}>
                {header}
                <section className={styles.stateCard} role="alert">
                    <AlertTriangle size={20} aria-hidden />
                    <div>
                        <h2>{state.missingApi ? t('plans.missingApiTitle') : t('plans.loadFailed')}</h2>
                        <p>{state.missingApi ? t('plans.missingApiText') : state.message}</p>
                    </div>
                    <button type="button" className={tableStyles.buttonSecondary} onClick={() => load()}>
                        <RefreshCw size={16} aria-hidden />
                        {t('home.retry')}
                    </button>
                </section>
            </div>
        );
    }

    const prices = state.prices;
    const withSub = rows.filter((row) => row.hasSubscription).length;

    return (
        <div className={tableStyles.page}>
            {header}
            {notice && (
                <div className={tableStyles.successMessage} role="status">
                    {notice}
                </div>
            )}

            {/* ------------------------------------------------ Resumen */}
            <section aria-labelledby="plans-summary" className={styles.statSection}>
                <h2 id="plans-summary" className={styles.statSectionTitle}>
                    {t('plans.summaryTitle')}
                </h2>
                <div className={tableStyles.statGrid}>
                    {(['active', 'trialing', 'payment', 'cancelScheduled', 'ended', 'none'] as const).map((group) => (
                        <button
                            key={group}
                            type="button"
                            className={`${tableStyles.statCard} ${styles.statButton} ${filters.estado === group ? styles.statButtonActive : ''}`}
                            onClick={() => setFilters((prev) => ({ ...prev, estado: prev.estado === group ? '' : group }))}
                            aria-pressed={filters.estado === group}
                        >
                            <span className={tableStyles.statLabel}>{t(`plans.groups.${group}`)}</span>
                            {/* Sin ninguna suscripción vinculada, los conteos de estado no tienen datos (no son 0) */}
                            {withSub === 0 && group !== 'none' ? (
                                <span className={styles.statMissing}>{t('home.noData')}</span>
                            ) : (
                                <span className={tableStyles.statValue}>{count(group)}</span>
                            )}
                        </button>
                    ))}
                    <div className={tableStyles.statCard}>
                        <span className={tableStyles.statLabel}>{t('home.stats.mrrLabel')}</span>
                        {!metrics || !metrics.mrrStatus || metrics.mrrStatus === 'unavailable' ? (
                            <span className={styles.statMissing}>{t('home.unavailable')}</span>
                        ) : metrics.payingTenants === 0 ? (
                            <span className={styles.statMissing}>{t('home.noData')}</span>
                        ) : (
                            <span className={tableStyles.statValue}>{formatMoney(metrics.mrr, metrics.currency)}</span>
                        )}
                        {metrics?.mrrStatus === 'partial' && (
                            <span className={tableStyles.cellSub}>{t('home.stats.mrrPartial', { count: metrics.unpricedTenants ?? 0 })}</span>
                        )}
                    </div>
                </div>
                <p className={tableStyles.cellSub}>{t('home.stats.mrrExplain')}</p>
                {count('unsynced') > 0 && <p className={styles.inlineNotice}>{t('plans.unsyncedNotice', { count: count('unsynced') })}</p>}
            </section>

            {/* ------------------------------------------------ Requieren atención */}
            <section className={styles.panel} aria-labelledby="plans-attention">
                <h2 id="plans-attention">{t('home.attentionTitle')}</h2>
                {attention.length === 0 ? (
                    <p className={tableStyles.cellSub}>{withSub === 0 ? t('plans.noSubscriptionsYet') : t('plans.attentionEmpty')}</p>
                ) : (
                    <ul className={styles.attentionList}>
                        {attention.map((row) => (
                            <li key={row.id} className={styles.jobRow} data-attention={row.slug}>
                                <div className={tableStyles.cellMain}>
                                    <Link href={`/plataforma/tiendas/${row.id}`} className={styles.tenantLink}>
                                        {row.name}
                                    </Link>
                                    <span className={tableStyles.cellSub}>
                                        {row.subscriptionStatus && PAYMENT_ISSUES.has(row.subscriptionStatus)
                                            ? t('plans.attention.payment', { status: subLabel(row.subscriptionStatus) })
                                            : t('plans.attention.foreignPrice')}
                                    </span>
                                </div>
                                {row.status === 'SUSPENDED' && (
                                    <span className={`${tableStyles.badge} ${tableStyles.badgeDanger}`}>{t('statuses.SUSPENDED')}</span>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            {/* ------------------------------------------------ Suscripciones */}
            <div className={styles.filters}>
                <input
                    className={tableStyles.input}
                    type="search"
                    value={filters.q}
                    onChange={(e) => setFilters((prev) => ({ ...prev, q: e.target.value }))}
                    placeholder={t('plans.searchPlaceholder')}
                    aria-label={t('plans.searchPlaceholder')}
                />
                <select
                    className={tableStyles.input}
                    value={filters.estado}
                    onChange={(e) => setFilters((prev) => ({ ...prev, estado: e.target.value as Group }))}
                    aria-label={t('plans.statusFilter')}
                >
                    <option value="">{t('allStatuses')}</option>
                    {GROUPS.map((group) => (
                        <option key={group} value={group}>
                            {t(`plans.groups.${group}`)}
                        </option>
                    ))}
                </select>
                <select
                    className={tableStyles.input}
                    value={filters.plan}
                    onChange={(e) => setFilters((prev) => ({ ...prev, plan: e.target.value }))}
                    aria-label={t('tenants.planFilter')}
                >
                    <option value="">{t('tenants.allPlans')}</option>
                    {planOptions.map((plan) => (
                        <option key={plan} value={plan}>
                            {planLabel(plan)}
                        </option>
                    ))}
                </select>
                {(filters.q || filters.estado || filters.plan) && (
                    <button type="button" className={tableStyles.buttonSecondary} onClick={() => setFilters({ q: '', estado: '', plan: '' })}>
                        <X size={14} aria-hidden />
                        {t('tenants.clearFilters')}
                    </button>
                )}
            </div>

            <div className={tableStyles.tableCard}>
                {visible.length === 0 ? (
                    <div className={tableStyles.emptyState}>{rows.length === 0 ? t('empty') : t('noResults')}</div>
                ) : (
                    <div className={tableStyles.tableWrapper}>
                        <table className={tableStyles.table}>
                            <thead>
                                <tr>
                                    <th>{t('columns.store')}</th>
                                    <th>{t('columns.plan')}</th>
                                    <th>{t('plans.columns.billing')}</th>
                                    <th>{t('columns.subscription')}</th>
                                    <th>{t('plans.columns.period')}</th>
                                    <th>{t('plans.columns.synced')}</th>
                                    <th className={tableStyles.numeric}>{t('columns.actions')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visible.map((row) => (
                                    <tr key={row.id} data-sub-slug={row.slug}>
                                        <td>
                                            <div className={tableStyles.cellMain}>
                                                <Link href={`/plataforma/tiendas/${row.id}`} className={styles.tenantLink}>
                                                    {row.name}
                                                </Link>
                                                <span className={tableStyles.cellSub}>
                                                    {row.slug}
                                                    {row.status !== 'ACTIVE' && ` · ${t(`statuses.${row.status}`)}`}
                                                </span>
                                            </div>
                                        </td>
                                        <td>
                                            <span className={`${tableStyles.badge} ${PLAN_BADGE[normalizePlan(row.plan)] ?? tableStyles.badgeMuted}`}>
                                                {planLabel(row.plan)}
                                            </span>
                                            {row.priceRecognized === false && <span className={tableStyles.rowError}>{t('plans.foreignPrice')}</span>}
                                        </td>
                                        <td>
                                            {!row.hasSubscription ? (
                                                <span className={tableStyles.cellSub}>—</span>
                                            ) : row.billingInterval ? (
                                                t(`plans.interval.${row.billingInterval}`)
                                            ) : (
                                                <span className={tableStyles.cellSub}>{t('home.noData')}</span>
                                            )}
                                        </td>
                                        <td>
                                            {row.subscriptionStatus ? (
                                                <span className={`${tableStyles.badge} ${SUBSCRIPTION_BADGE[row.subscriptionStatus] ?? tableStyles.badgeMuted}`}>
                                                    {subLabel(row.subscriptionStatus)}
                                                </span>
                                            ) : (
                                                <span className={tableStyles.cellSub}>{t('noSubscription')}</span>
                                            )}
                                        </td>
                                        <td>{periodCell(row)}</td>
                                        <td className={tableStyles.cellSub}>
                                            {!row.hasSubscription ? '—' : row.subscriptionSyncedAt ? formatDateTime(row.subscriptionSyncedAt) : t('plans.groups.unsynced')}
                                        </td>
                                        <td>
                                            <div className={tableStyles.actions}>
                                                {row.hasSubscription && (
                                                    <button
                                                        type="button"
                                                        className={tableStyles.buttonSecondary}
                                                        onClick={() => {
                                                            setSyncError(null);
                                                            setSyncTarget(row);
                                                        }}
                                                    >
                                                        <RefreshCw size={14} aria-hidden />
                                                        {t('plans.sync.button')}
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* ------------------------------------------------ Catálogo de este proyecto */}
            <section className={styles.panel} aria-labelledby="plans-catalog">
                <h2 id="plans-catalog">{t('plans.catalogTitle')}</h2>
                <p className={tableStyles.cellSub}>{t('plans.catalogText')}</p>
                {!prices ? (
                    <p className={tableStyles.cellSub}>{t('plans.catalogUnavailable')}</p>
                ) : (
                    <dl className={styles.factList}>
                        {['starter', 'growth', 'pro'].map((plan) => (
                            <div key={plan}>
                                <dt>{PLAN_NAMES[plan]}</dt>
                                {(['monthly', 'annual'] as const).map((interval) => {
                                    const price = prices.find((p) => p.plan === plan && p.interval === interval);
                                    return (
                                        <dd key={interval}>
                                            {t(`plans.interval.${interval}`)}:{' '}
                                            {price?.available && price.amount != null && price.currency
                                                ? formatMoney(price.amount, price.currency)
                                                : t('plans.priceNotConfigured')}
                                        </dd>
                                    );
                                })}
                            </div>
                        ))}
                    </dl>
                )}
            </section>

            {syncTarget && (
                <div className={tableStyles.overlay} onMouseDown={(e) => e.target === e.currentTarget && !syncing && setSyncTarget(null)}>
                    <div className={`${tableStyles.modal} ${styles.dialog}`} role="dialog" aria-modal="true" aria-labelledby="sync-title">
                        <div className={tableStyles.modalHeader}>
                            <h2 id="sync-title">{t('plans.sync.title', { name: syncTarget.name })}</h2>
                        </div>
                        <ul className={styles.effectList}>
                            {(t.raw('plans.sync.effects') as string[]).map((effect) => (
                                <li key={effect}>{effect}</li>
                            ))}
                        </ul>
                        {syncError && (
                            <div className={tableStyles.errorMessage} role="alert">
                                {syncError}
                            </div>
                        )}
                        <div className={tableStyles.modalFooter}>
                            <button type="button" className={tableStyles.buttonSecondary} onClick={() => setSyncTarget(null)} disabled={syncing}>
                                {t('tenants.actions.cancel')}
                            </button>
                            <button type="button" className={tableStyles.button} onClick={confirmSync} disabled={syncing} autoFocus>
                                {syncing ? t('tenants.actions.working') : t('plans.sync.confirm')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
