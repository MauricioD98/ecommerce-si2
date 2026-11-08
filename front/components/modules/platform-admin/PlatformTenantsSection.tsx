'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronRight, ExternalLink, PauseCircle, PlayCircle, RotateCcw, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import tableStyles from '@/components/modules/admin/admin-table.module.scss';
import styles from './platform-admin.module.scss';
import { intlLocale } from '@/i18n/config';
import type { PlatformTenant, TenantStatus } from '@/service/api/platformAdmin.service';
import { usePlatformAdmin } from './PlatformAdminContext';
import TenantActionDialog, { type TenantActionKind } from './TenantActionDialog';
import {
    KNOWN_SUBSCRIPTION_STATUSES,
    PLAN_BADGE,
    PLAN_NAMES,
    STATUS_BADGE,
    SUBSCRIPTION_BADGE,
    TENANT_STATUSES,
    normalizePlan,
} from './tenantDisplay';

// Tiendas del SaaS: buscar, filtrar por estado y plan, abrir el detalle y suspender/reactivar/reintentar.
// Los filtros viven en la URL (?q=&estado=&plan=): sobreviven a la recarga y al volver desde el detalle.
// La búsqueda y los filtros son sobre la lista ya cargada (GET /platform/tenants): no hacen consultas.

export default function PlatformTenantsSection() {
    const t = useTranslations('PlatformAdmin');
    const tSub = useTranslations('AdminSubscription');
    const locale = useLocale();
    const router = useRouter();
    const pathname = usePathname();
    const params = useSearchParams();
    const { tenants, isLoading, reload } = usePlatformAdmin();

    const [notice, setNotice] = useState<string | null>(null);
    const [action, setAction] = useState<{ kind: TenantActionKind; tenant: PlatformTenant } | null>(null);

    // Los filtros viven en estado local (fuente de verdad) y la URL se sincroniza desde ahí. Armar la
    // URL a partir de useSearchParams en cada cambio perdía cambios rápidos seguidos (el segundo
    // partía de parámetros todavía sin actualizar).
    const [filters, setFilters] = useState(() => {
        const status = params.get('estado') ?? '';
        return {
            q: params.get('q') ?? '',
            estado: (TENANT_STATUSES as string[]).includes(status) ? (status as TenantStatus) : ('' as TenantStatus | ''),
            plan: normalizePlan(params.get('plan')),
        };
    });
    const { q: search, estado: statusFilter, plan: planFilter } = filters;
    const query = useMemo(() => {
        const next = new URLSearchParams();
        if (search) next.set('q', search);
        if (statusFilter) next.set('estado', statusFilter);
        if (planFilter) next.set('plan', planFilter);
        return next.toString();
    }, [search, statusFilter, planFilter]);

    useEffect(() => {
        if (query !== params.toString()) router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
        // Solo cuando cambian los filtros: params cambia como consecuencia de este mismo replace
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query]);

    const setParam = (key: 'q' | 'estado' | 'plan', value: string) => setFilters((prev) => ({ ...prev, [key]: value }));

    const planLabel = useCallback(
        (plan: string) => {
            const key = normalizePlan(plan);
            if (PLAN_NAMES[key]) return PLAN_NAMES[key];
            if (key === 'free' || key === 'legacy') return t(`tenants.plans.${key}`);
            return plan || t('tenants.plans.none');
        },
        [t],
    );

    // Planes que existen en los datos (no una lista fija): así un plan nuevo o "legacy" también se filtra
    const planOptions = useMemo(() => {
        const order = ['starter', 'growth', 'pro', 'free', 'legacy'];
        const present = Array.from(new Set(tenants.map((tenant) => normalizePlan(tenant.plan))));
        return present.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b));
    }, [tenants]);

    const visibleTenants = useMemo(() => {
        const term = search.trim().toLowerCase();
        return tenants.filter(
            (tenant) =>
                (!statusFilter || tenant.status === statusFilter) &&
                (!planFilter || normalizePlan(tenant.plan) === planFilter) &&
                (!term ||
                    [tenant.name, tenant.slug, tenant.id, tenant.domain, tenant.ownerEmail].some((value) => value?.toLowerCase().includes(term))),
        );
    }, [tenants, search, statusFilter, planFilter]);

    const hasFilters = !!(search || statusFilter || planFilter);
    const formatDate = (value: string) =>
        new Date(value).toLocaleDateString(intlLocale(locale), { day: '2-digit', month: 'short', year: 'numeric' });
    const detailHref = (tenant: PlatformTenant) => {
        const back = query;
        return `/plataforma/tiendas/${tenant.id}${back ? `?volver=${encodeURIComponent(back)}` : ''}`;
    };

    return (
        <div className={tableStyles.page}>
            <div className={tableStyles.pageHeader}>
                <div>
                    <h1>{t('title')}</h1>
                    <p>{t('subtitle')}</p>
                </div>
            </div>

            {notice && (
                <div className={tableStyles.successMessage} role="status">
                    {notice}
                </div>
            )}

            <div className={styles.filters}>
                <input
                    className={tableStyles.input}
                    type="search"
                    value={search}
                    onChange={(e) => {
                        setParam('q', e.target.value);
                    }}
                    placeholder={t('tenants.searchPlaceholder')}
                    aria-label={t('tenants.searchPlaceholder')}
                />
                <select
                    className={tableStyles.input}
                    value={statusFilter}
                    onChange={(e) => setParam('estado', e.target.value)}
                    aria-label={t('statusFilter')}
                >
                    <option value="">{t('allStatuses')}</option>
                    {TENANT_STATUSES.map((status) => (
                        <option key={status} value={status}>
                            {t(`statuses.${status}`)}
                        </option>
                    ))}
                </select>
                <select className={tableStyles.input} value={planFilter} onChange={(e) => setParam('plan', e.target.value)} aria-label={t('tenants.planFilter')}>
                    <option value="">{t('tenants.allPlans')}</option>
                    {planOptions.map((plan) => (
                        <option key={plan || 'none'} value={plan}>
                            {planLabel(plan)}
                        </option>
                    ))}
                </select>
                {hasFilters && (
                    <button type="button" className={tableStyles.buttonSecondary} onClick={() => {
                            setFilters({ q: '', estado: '', plan: '' });
                        }}
                    >
                        <X size={14} aria-hidden />
                        {t('tenants.clearFilters')}
                    </button>
                )}
            </div>

            {tenants.length > 0 && (
                <p className={tableStyles.cellSub} aria-live="polite">
                    {t('tenants.resultCount', { shown: visibleTenants.length, total: tenants.length })}
                </p>
            )}

            <div className={tableStyles.tableCard}>
                {isLoading && tenants.length === 0 ? (
                    <div className={tableStyles.loadingState}>{t('loading')}</div>
                ) : visibleTenants.length === 0 ? (
                    <div className={tableStyles.emptyState}>{tenants.length === 0 ? t('empty') : t('noResults')}</div>
                ) : (
                    <div className={tableStyles.tableWrapper}>
                        <table className={tableStyles.table}>
                            <thead>
                                <tr>
                                    <th>{t('columns.store')}</th>
                                    <th>{t('columns.owner')}</th>
                                    <th>{t('columns.plan')}</th>
                                    <th>{t('columns.subscription')}</th>
                                    <th>{t('columns.status')}</th>
                                    <th>{t('columns.created')}</th>
                                    <th className={tableStyles.numeric}>{t('columns.actions')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visibleTenants.map((tenant) => {
                                    const subscription = tenant.subscriptionStatus;
                                    return (
                                        <tr key={tenant.id} data-tenant-slug={tenant.slug}>
                                            <td>
                                                <div className={tableStyles.cellMain}>
                                                    <Link href={detailHref(tenant)} className={styles.tenantLink}>
                                                        {tenant.name}
                                                    </Link>
                                                    <span className={tableStyles.cellSub}>{tenant.domain ?? tenant.slug}</span>
                                                    {tenant.provisionError && (
                                                        <span className={tableStyles.rowError} title={tenant.provisionError}>
                                                            {tenant.provisionError.slice(0, 80)}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td>{tenant.ownerEmail ?? <span className={tableStyles.cellSub}>{t('noOwner')}</span>}</td>
                                            <td>
                                                <span className={`${tableStyles.badge} ${PLAN_BADGE[normalizePlan(tenant.plan)] ?? tableStyles.badgeMuted}`}>
                                                    {planLabel(tenant.plan)}
                                                </span>
                                            </td>
                                            <td>
                                                {subscription ? (
                                                    <span className={`${tableStyles.badge} ${SUBSCRIPTION_BADGE[subscription] ?? tableStyles.badgeMuted}`}>
                                                        {(KNOWN_SUBSCRIPTION_STATUSES as string[]).includes(subscription)
                                                            ? tSub(`statuses.${subscription as 'active'}`)
                                                            : subscription}
                                                    </span>
                                                ) : (
                                                    <span className={tableStyles.cellSub}>{t('noSubscription')}</span>
                                                )}
                                            </td>
                                            <td>
                                                <span className={`${tableStyles.badge} ${STATUS_BADGE[tenant.status]}`}>{t(`statuses.${tenant.status}`)}</span>
                                            </td>
                                            <td className={tableStyles.cellSub}>{formatDate(tenant.createdAt)}</td>
                                            <td>
                                                <div className={tableStyles.actions}>
                                                    <Link href={detailHref(tenant)} className={tableStyles.buttonSecondary}>
                                                        {t('tenants.viewDetail')}
                                                        <ChevronRight size={14} aria-hidden />
                                                    </Link>
                                                    {tenant.status === 'ACTIVE' && (
                                                        <button type="button" className={tableStyles.buttonDanger} onClick={() => setAction({ kind: 'suspend', tenant })}>
                                                            <PauseCircle size={14} aria-hidden />
                                                            {t('suspend')}
                                                        </button>
                                                    )}
                                                    {tenant.status === 'SUSPENDED' && (
                                                        <button type="button" className={tableStyles.button} onClick={() => setAction({ kind: 'reactivate', tenant })}>
                                                            <PlayCircle size={14} aria-hidden />
                                                            {t('reactivate')}
                                                        </button>
                                                    )}
                                                    {tenant.status === 'FAILED' && (
                                                        <button type="button" className={tableStyles.buttonSecondary} onClick={() => setAction({ kind: 'retry', tenant })}>
                                                            <RotateCcw size={14} aria-hidden />
                                                            {t('retry')}
                                                        </button>
                                                    )}
                                                    {tenant.status === 'ACTIVE' && (
                                                        <a
                                                            className={tableStyles.buttonSecondary}
                                                            href={`/?tenant=${encodeURIComponent(tenant.id)}`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            title={t('tenants.openStorefrontHint')}
                                                        >
                                                            <ExternalLink size={14} aria-hidden />
                                                            {t('open')}
                                                        </a>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {action && (
                <TenantActionDialog
                    kind={action.kind}
                    tenant={action.tenant}
                    onClose={() => setAction(null)}
                    onDone={async (message) => {
                        setAction(null);
                        setNotice(message);
                        await reload();
                    }}
                />
            )}
        </div>
    );
}
