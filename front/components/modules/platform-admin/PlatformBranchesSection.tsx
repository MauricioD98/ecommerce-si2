'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import tableStyles from '@/components/modules/admin/admin-table.module.scss';
import styles from './platform-admin.module.scss';
import { intlLocale } from '@/i18n/config';
import type { PlatformTenantBranches } from '@/service/api/platformAdmin.service';
import { usePlatformAdmin } from './PlatformAdminContext';
import { STATUS_BADGE } from './tenantDisplay';

// Sucursales de la plataforma: supervisión de solo lectura. Crear, editar o eliminar sucursales, el
// inventario y los empleados se siguen gestionando en el panel de cada tienda.
//
// Cada tienda trae su "availability": si no se pudo consultar, se dice "datos no disponibles" y no se
// cuenta como 0 sucursales. Los filtros viven en la URL (?tienda=&estado=&q=); con ?tienda= (por
// ejemplo, al venir del detalle de una tienda) solo se consulta esa tienda.

type BranchStatusFilter = '' | 'activa' | 'inactiva';

export default function PlatformBranchesSection() {
    const t = useTranslations('PlatformAdmin');
    const locale = useLocale();
    const router = useRouter();
    const pathname = usePathname();
    const params = useSearchParams();
    const { tenants, branchOverview, loadBranches } = usePlatformAdmin();

    const [filters, setFilters] = useState(() => {
        const estado = params.get('estado');
        return {
            q: params.get('q') ?? '',
            tienda: params.get('tienda') ?? '',
            estado: (estado === 'activa' || estado === 'inactiva' ? estado : '') as BranchStatusFilter,
        };
    });
    const query = useMemo(() => {
        const next = new URLSearchParams();
        if (filters.tienda) next.set('tienda', filters.tienda);
        if (filters.estado) next.set('estado', filters.estado);
        if (filters.q) next.set('q', filters.q);
        return next.toString();
    }, [filters]);

    useEffect(() => {
        if (query !== params.toString()) router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
        // Solo cuando cambian los filtros (params cambia como consecuencia de este replace)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query]);

    // Alcance necesario: una tienda o todas. Si ya están todas cargadas, filtrar por tienda no consulta.
    const neededScope = filters.tienda || 'all';
    const loadedScope = branchOverview.status === 'idle' ? null : branchOverview.scope;
    const covered = branchOverview.status !== 'idle' && (loadedScope === neededScope || (loadedScope === 'all' && branchOverview.status === 'ready'));
    useEffect(() => {
        if (!covered) loadBranches(neededScope);
    }, [covered, neededScope, loadBranches]);

    const data = branchOverview.status === 'ready' ? branchOverview.data : null;
    const scopedTenants: PlatformTenantBranches[] = useMemo(
        () => (data ? data.tenants.filter((tenant) => !filters.tienda || tenant.tenantId === filters.tienda) : []),
        [data, filters.tienda],
    );

    const rows = useMemo(() => {
        const term = filters.q.trim().toLowerCase();
        return scopedTenants.flatMap((tenant) =>
            tenant.branches
                .filter(
                    (branch) =>
                        (!filters.estado || (filters.estado === 'activa') === branch.isActive) &&
                        (!term || [branch.name, branch.address, tenant.tenantName, tenant.tenantSlug].some((value) => value?.toLowerCase().includes(term))),
                )
                .map((branch) => ({ tenant, branch })),
        );
    }, [scopedTenants, filters.q, filters.estado]);

    const available = scopedTenants.filter((tenant) => tenant.availability === 'available');
    const missing = scopedTenants.filter((tenant) => tenant.availability !== 'available');
    const totalBranches = available.reduce((sum, tenant) => sum + tenant.branches.length, 0);
    const withoutBranches = available.filter((tenant) => tenant.branches.length === 0);
    const hasFilters = !!(filters.q || filters.tienda || filters.estado);

    // Opciones de tienda: la lista que ya cargó el panel (no hace falta consultar todas las tiendas)
    const tenantOptions = useMemo(() => [...tenants].sort((a, b) => a.name.localeCompare(b.name)), [tenants]);
    const selectedTenantName = tenants.find((tenant) => tenant.id === filters.tienda)?.name ?? scopedTenants[0]?.tenantName;

    const formatDate = (value: string) =>
        new Date(value).toLocaleDateString(intlLocale(locale), { day: '2-digit', month: 'short', year: 'numeric' });
    const setFilter = (key: 'q' | 'tienda' | 'estado', value: string) => setFilters((prev) => ({ ...prev, [key]: value }));

    return (
        <div className={tableStyles.page}>
            <div className={tableStyles.pageHeader}>
                <div>
                    <h1>{t('nav.branches')}</h1>
                    <p>{t('branches.subtitle')}</p>
                </div>
                <button
                    type="button"
                    className={tableStyles.buttonSecondary}
                    onClick={() => loadBranches(neededScope)}
                    disabled={branchOverview.status === 'loading'}
                >
                    <RefreshCw size={16} aria-hidden className={branchOverview.status === 'loading' ? styles.spin : ''} />
                    {t('branches.reload')}
                </button>
            </div>

            <p className={styles.inlineNotice}>{t('branches.readOnly')}</p>

            <div className={styles.filters}>
                <input
                    className={tableStyles.input}
                    type="search"
                    value={filters.q}
                    onChange={(e) => setFilter('q', e.target.value)}
                    placeholder={t('branches.searchPlaceholder')}
                    aria-label={t('branches.searchPlaceholder')}
                />
                <select className={tableStyles.input} value={filters.tienda} onChange={(e) => setFilter('tienda', e.target.value)} aria-label={t('branches.storeFilter')}>
                    <option value="">{t('branches.allStores')}</option>
                    {tenantOptions.map((tenant) => (
                        <option key={tenant.id} value={tenant.id}>
                            {tenant.name} ({tenant.slug})
                        </option>
                    ))}
                    {/* Tienda pedida por URL que todavía no está en la lista cargada */}
                    {filters.tienda && !tenantOptions.some((tenant) => tenant.id === filters.tienda) && (
                        <option value={filters.tienda}>{selectedTenantName ?? filters.tienda}</option>
                    )}
                </select>
                <select className={tableStyles.input} value={filters.estado} onChange={(e) => setFilter('estado', e.target.value)} aria-label={t('branches.statusFilter')}>
                    <option value="">{t('branches.allStatuses')}</option>
                    <option value="activa">{t('branches.active')}</option>
                    <option value="inactiva">{t('branches.inactive')}</option>
                </select>
                {hasFilters && (
                    <button type="button" className={tableStyles.buttonSecondary} onClick={() => setFilters({ q: '', tienda: '', estado: '' })}>
                        <X size={14} aria-hidden />
                        {t('tenants.clearFilters')}
                    </button>
                )}
            </div>

            {branchOverview.status === 'error' && branchOverview.scope === neededScope ? (
                <section className={styles.stateCard} role="alert">
                    <AlertTriangle size={20} aria-hidden />
                    <div>
                        <h2>{t('branches.loadFailed')}</h2>
                        <p>{branchOverview.message}</p>
                    </div>
                    <button type="button" className={tableStyles.buttonSecondary} onClick={() => loadBranches(neededScope)}>
                        <RefreshCw size={16} aria-hidden />
                        {t('home.retry')}
                    </button>
                </section>
            ) : !data || !covered ? (
                <div className={tableStyles.loadingState} aria-busy="true">
                    {t('branches.loading')}
                </div>
            ) : (
                <>
                    <p className={tableStyles.cellSub} aria-live="polite">
                        {t('branches.summary', { branches: totalBranches, stores: available.length })}
                        {missing.length > 0 && ` · ${t('branches.summaryMissing', { count: missing.length })}`}
                        {` · ${t('home.updatedAt', { time: new Date(data.generatedAt).toLocaleTimeString(intlLocale(locale), { hour: '2-digit', minute: '2-digit' }) })}`}
                    </p>

                    {missing.length > 0 && (
                        <section className={styles.panel} aria-labelledby="branches-missing">
                            <h2 id="branches-missing">{t('branches.missingTitle')}</h2>
                            <ul className={styles.attentionList}>
                                {missing.map((tenant) => (
                                    <li key={tenant.tenantId} className={styles.jobRow} data-missing-tenant={tenant.tenantSlug}>
                                        <div className={tableStyles.cellMain}>
                                            <Link href={`/plataforma/tiendas/${tenant.tenantId}`} className={styles.tenantLink}>
                                                {tenant.tenantName}
                                            </Link>
                                            <span className={tableStyles.cellSub}>
                                                {tenant.availability === 'not_provisioned' ? t('branches.notProvisioned') : t('branches.unavailable')}
                                            </span>
                                        </div>
                                        <span className={styles.statMissingSmall}>{t('home.unavailable')}</span>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}

                    <div className={tableStyles.tableCard}>
                        {rows.length === 0 ? (
                            <div className={tableStyles.emptyState}>
                                {available.length === 0
                                    ? filters.tienda
                                        ? t('branches.storeUnavailable')
                                        : t('branches.noStores')
                                    : totalBranches === 0
                                      ? filters.tienda
                                          ? t('branches.storeHasNone', { name: selectedTenantName ?? '' })
                                          : t('branches.noneAnywhere')
                                      : t('branches.noResults')}
                            </div>
                        ) : (
                            <div className={tableStyles.tableWrapper}>
                                <table className={tableStyles.table}>
                                    <thead>
                                        <tr>
                                            <th>{t('branches.columns.store')}</th>
                                            <th>{t('branches.columns.branch')}</th>
                                            <th>{t('branches.columns.status')}</th>
                                            <th>{t('branches.columns.address')}</th>
                                            <th>{t('branches.columns.created')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map(({ tenant, branch }) => (
                                            <tr key={`${tenant.tenantId}:${branch.id}`} data-branch={`${tenant.tenantSlug}/${branch.name}`}>
                                                <td>
                                                    <div className={tableStyles.cellMain}>
                                                        <Link href={`/plataforma/tiendas/${tenant.tenantId}`} className={styles.tenantLink}>
                                                            {tenant.tenantName}
                                                        </Link>
                                                        <span className={tableStyles.cellSub}>
                                                            {tenant.tenantSlug}
                                                            {tenant.tenantStatus !== 'ACTIVE' && (
                                                                <>
                                                                    {' · '}
                                                                    <span className={`${tableStyles.badge} ${STATUS_BADGE[tenant.tenantStatus]}`}>
                                                                        {t(`statuses.${tenant.tenantStatus}`)}
                                                                    </span>
                                                                </>
                                                            )}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className={tableStyles.cellTitle}>{branch.name}</td>
                                                <td>
                                                    <span className={`${tableStyles.badge} ${branch.isActive ? tableStyles.badgeSuccess : tableStyles.badgeMuted}`}>
                                                        {branch.isActive ? t('branches.active') : t('branches.inactive')}
                                                    </span>
                                                </td>
                                                <td>{branch.address ?? <span className={tableStyles.cellSub}>{t('branches.noAddress')}</span>}</td>
                                                <td className={tableStyles.cellSub}>{formatDate(branch.createdAt)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    {withoutBranches.length > 0 && !filters.tienda && (
                        <p className={tableStyles.cellSub}>
                            {t('branches.storesWithoutBranches', { names: withoutBranches.map((tenant) => tenant.tenantName).join(', ') })}
                        </p>
                    )}
                    <p className={tableStyles.cellSub}>{t('branches.cityNote')}</p>
                </>
            )}
        </div>
    );
}
