'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import tableStyles from '@/components/modules/admin/admin-table.module.scss';
import styles from './platform-admin.module.scss';
import { intlLocale } from '@/i18n/config';
import {
    PlatformApiError,
    type PlatformAdminAccount,
    type PlatformAuditEntry,
    type PlatformAuditFilters,
    platformAdminService,
} from '@/service/api/platformAdmin.service';
import { usePlatformAdmin } from './PlatformAdminContext';

// Administradores del SaaS (public.platform_admins) y auditoría de las acciones de la plataforma
// (public.platform_audit_log). Solo administradores de PLATAFORMA: los dueños y empleados de las tiendas
// no aparecen acá. La auditoría empieza en su registro AUDIT_STARTED; no se muestra historial anterior.

// Mismas acciones que AUDIT_ACTIONS en la API (sin AUDIT_STARTED, que es la marca de inicio)
const ACTIONS = [
    'PLATFORM_LOGIN',
    'TENANT_CREATED',
    'TENANT_SUSPENDED',
    'TENANT_REACTIVATED',
    'TENANT_SUSPENDED_BY_BILLING',
    'TENANT_REACTIVATED_BY_BILLING',
    'TENANT_PROVISION_RETRIED',
    'TENANT_DOMAIN_CHANGED',
    'TENANT_INTEGRATION_CHANGED',
    'SUBSCRIPTION_SYNCED',
    'SIGNUP_RETRIED',
    'BACKUP_CREATED',
    'BACKUP_UPLOADED',
    'BACKUP_DOWNLOADED',
    'BACKUP_RESTORE_STARTED',
    'BACKUP_DELETED',
] as const;
type KnownAction = (typeof ACTIONS)[number] | 'AUDIT_STARTED';
const BACKUP_STATUSES = ['PREPARING', 'AVAILABLE', 'VALIDATING', 'RESTORING', 'COMPLETED', 'FAILED'] as const;

type AdminsState = { status: 'loading' } | { status: 'ready'; admins: PlatformAdminAccount[] } | { status: 'error'; message: string };
type AuditState =
    | { status: 'loading' }
    | { status: 'ready'; entries: PlatformAuditEntry[]; hasMore: boolean; startedAt: string | null; loadingMore: boolean }
    | { status: 'error'; message: string; unavailable: boolean };

const emptyFilters = { action: '', tenantId: '', actorEmail: '', result: '', from: '', to: '' };

export default function PlatformAdminsSection() {
    const t = useTranslations('PlatformAdmin');
    const tb = useTranslations('Backups');
    const locale = useLocale();
    const { token, tenants, loadedAt, reportError } = usePlatformAdmin();

    const [admins, setAdmins] = useState<AdminsState>({ status: 'loading' });
    const [audit, setAudit] = useState<AuditState>({ status: 'loading' });
    const [filters, setFilters] = useState(emptyFilters);

    const formatDateTime = (value: string) =>
        new Date(value).toLocaleString(intlLocale(locale), { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    // Filtros → parámetros de la API (las fechas del input son días locales completos)
    const apiFilters = useMemo<PlatformAuditFilters>(() => {
        const day = (value: string, addDays = 0) => {
            if (!value) return undefined;
            const date = new Date(`${value}T00:00:00`);
            date.setDate(date.getDate() + addDays);
            return date.toISOString();
        };
        return {
            action: filters.action || undefined,
            tenantId: filters.tenantId || undefined,
            actorEmail: filters.actorEmail || undefined,
            result: filters.result || undefined,
            from: day(filters.from),
            to: day(filters.to, 1),
        };
    }, [filters]);

    const loadAdmins = useCallback(async () => {
        if (!token) return;
        try {
            setAdmins({ status: 'ready', admins: await platformAdminService.getAdmins(token) });
        } catch (err) {
            if (err instanceof PlatformApiError && err.status === 401) return reportError(err, t('loadFailed'));
            setAdmins({ status: 'error', message: err instanceof Error && err.message ? err.message : t('admins.loadFailed') });
        }
    }, [token, reportError, t]);

    const loadAudit = useCallback(
        async (before?: string) => {
            if (!token) return;
            if (before) setAudit((prev) => (prev.status === 'ready' ? { ...prev, loadingMore: true } : prev));
            else setAudit({ status: 'loading' });
            try {
                const page = await platformAdminService.getAudit(token, { ...apiFilters, before });
                setAudit((prev) => ({
                    status: 'ready',
                    entries: before && prev.status === 'ready' ? [...prev.entries, ...page.entries] : page.entries,
                    hasMore: page.hasMore,
                    startedAt: page.auditStartedAt,
                    loadingMore: false,
                }));
            } catch (err) {
                if (err instanceof PlatformApiError && err.status === 401) return reportError(err, t('loadFailed'));
                setAudit({
                    status: 'error',
                    message: err instanceof Error && err.message ? err.message : t('audit.loadFailed'),
                    // 503: tabla sin migrar; 404: API anterior sin esta ruta
                    unavailable: err instanceof PlatformApiError && (err.status === 503 || err.status === 404),
                });
            }
        },
        [token, apiFilters, reportError, t],
    );

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        loadAdmins();
    }, [loadAdmins, loadedAt]);
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        loadAudit();
    }, [loadAudit, loadedAt]);

    // ------------------------------------------------------------------ Presentación
    const adminStatus = (admin: PlatformAdminAccount) =>
        !admin.isActive ? 'inactive' : admin.lockedUntil ? 'locked' : 'active';

    const actorLabel = (entry: PlatformAuditEntry) => {
        if (entry.actorType === 'SYSTEM') return t('audit.actors.system');
        if (entry.actorType === 'PLATFORM_KEY') return t('audit.actors.key');
        if (entry.actorType === 'ANONYMOUS') return entry.actorEmail ? t('audit.actors.anonymousWith', { email: entry.actorEmail }) : t('audit.actors.anonymous');
        return entry.actorEmail ?? '—';
    };
    const actionLabel = (action: string) =>
        (ACTIONS as readonly string[]).includes(action) || action === 'AUDIT_STARTED' ? t(`audit.actions.${action as KnownAction}`) : action;
    const statusLabel = (status: unknown) =>
        typeof status === 'string' && ['ACTIVE', 'SUSPENDED', 'PROVISIONING', 'FAILED'].includes(status)
            ? t(`statuses.${status as 'ACTIVE'}`)
            : String(status ?? '—');
    const detailText = (entry: PlatformAuditEntry) => {
        const d = entry.details ?? {};
        const parts: string[] = [];
        if (d.from !== undefined || d.to !== undefined) parts.push(`${statusLabel(d.from)} → ${statusLabel(d.to)}`);
        if (d.scope) parts.push(d.scope === 'PLATFORM' ? tb('scopeBadge.platform') : tb('scopeBadge.tenant'));
        if (d.provider) parts.push(`${d.provider}${d.operation ? ` · ${d.operation}` : ''}`);
        if ('domain' in d) parts.push(d.domain ? String(d.domain) : t('audit.domainRemoved'));
        if (d.plan) parts.push(String(d.plan));
        if (d.subscriptionStatus) parts.push(String(d.subscriptionStatus));
        return parts.join(' · ');
    };
    const resultCell = (entry: PlatformAuditEntry) => {
        const badge = (cls: string, text: string) => <span className={`${tableStyles.badge} ${cls}`}>{text}</span>;
        if (entry.result === 'FAILURE')
            return (
                <div className={tableStyles.cellMain}>
                    {badge(tableStyles.badgeDanger, t('audit.results.FAILURE'))}
                    {entry.errorCode && <span className={tableStyles.cellSub}>{entry.errorCode}</span>}
                </div>
            );
        if (entry.result === 'REQUESTED') {
            // Operación de respaldo: su estado final está en backup_jobs
            const job = entry.jobStatus && (BACKUP_STATUSES as readonly string[]).includes(entry.jobStatus) ? entry.jobStatus : null;
            return (
                <div className={tableStyles.cellMain}>
                    {badge(tableStyles.badgeInfo, t('audit.results.REQUESTED'))}
                    <span className={tableStyles.cellSub}>
                        {job ? tb(`status.${job as 'AVAILABLE'}`) : t('audit.jobUnknown')}
                    </span>
                </div>
            );
        }
        return badge(tableStyles.badgeSuccess, t('audit.results.SUCCESS'));
    };

    const adminEmails = admins.status === 'ready' ? admins.admins.map((a) => a.email) : [];
    const hasFilters = Object.values(filters).some(Boolean);
    const setFilter = (key: keyof typeof emptyFilters, value: string) => setFilters((prev) => ({ ...prev, [key]: value }));

    return (
        <div className={tableStyles.page}>
            <div className={tableStyles.pageHeader}>
                <div>
                    <h1>{t('nav.admins')}</h1>
                    <p>{t('admins.subtitle')}</p>
                </div>
            </div>

            {/* ------------------------------------------------ Administradores */}
            <section className={styles.panel} aria-labelledby="admins-title">
                <h2 id="admins-title">{t('admins.title')}</h2>
                <p className={tableStyles.cellSub}>{t('admins.scopeNote')}</p>
                {admins.status === 'loading' ? (
                    <p className={tableStyles.cellSub} aria-busy="true">{t('admins.loading')}</p>
                ) : admins.status === 'error' ? (
                    <div className={styles.inlineError} role="alert">
                        <span>{admins.message}</span>
                        <button type="button" className={tableStyles.buttonSecondary} onClick={() => loadAdmins()}>
                            <RefreshCw size={14} aria-hidden />
                            {t('home.retry')}
                        </button>
                    </div>
                ) : (
                    <div className={tableStyles.tableWrapper}>
                        <table className={tableStyles.table}>
                            <thead>
                                <tr>
                                    <th>{t('admins.columns.admin')}</th>
                                    <th>{t('admins.columns.status')}</th>
                                    <th>{t('admins.columns.lastLogin')}</th>
                                    <th>{t('admins.columns.created')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {admins.admins.map((admin) => {
                                    const status = adminStatus(admin);
                                    return (
                                        <tr key={admin.id} data-admin={admin.email}>
                                            <td>
                                                <div className={tableStyles.cellMain}>
                                                    <span className={tableStyles.cellTitle}>{admin.email}</span>
                                                    {admin.name && <span className={tableStyles.cellSub}>{admin.name}</span>}
                                                </div>
                                            </td>
                                            <td>
                                                <div className={tableStyles.cellMain}>
                                                    <span
                                                        className={`${tableStyles.badge} ${
                                                            status === 'active' ? tableStyles.badgeSuccess : status === 'locked' ? tableStyles.badgeWarning : tableStyles.badgeMuted
                                                        }`}
                                                    >
                                                        {t(`admins.status.${status}`)}
                                                    </span>
                                                    {admin.lockedUntil && (
                                                        <span className={tableStyles.cellSub}>{t('admins.lockedUntil', { date: formatDateTime(admin.lockedUntil) })}</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className={tableStyles.cellSub}>{admin.lastLoginAt ? formatDateTime(admin.lastLoginAt) : t('admins.neverLoggedIn')}</td>
                                            <td className={tableStyles.cellSub}>{formatDateTime(admin.createdAt)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
                <p className={tableStyles.cellSub}>{t('admins.managePending')}</p>
            </section>

            {/* ------------------------------------------------ Auditoría */}
            <section className={styles.panel} aria-labelledby="audit-title">
                <h2 id="audit-title">{t('audit.title')}</h2>
                {audit.status === 'ready' && (
                    <p className={styles.inlineNotice}>
                        {audit.startedAt ? t('audit.since', { date: formatDateTime(audit.startedAt) }) : t('audit.sinceUnknown')} {t('audit.noHistoryBefore')}
                    </p>
                )}

                <div className={styles.filters}>
                    <select className={tableStyles.input} value={filters.action} onChange={(e) => setFilter('action', e.target.value)} aria-label={t('audit.filters.action')}>
                        <option value="">{t('audit.filters.allActions')}</option>
                        {ACTIONS.map((action) => (
                            <option key={action} value={action}>
                                {t(`audit.actions.${action}`)}
                            </option>
                        ))}
                    </select>
                    <select className={tableStyles.input} value={filters.tenantId} onChange={(e) => setFilter('tenantId', e.target.value)} aria-label={t('audit.filters.store')}>
                        <option value="">{t('audit.filters.allStores')}</option>
                        {[...tenants].sort((a, b) => a.name.localeCompare(b.name)).map((tenant) => (
                            <option key={tenant.id} value={tenant.id}>
                                {tenant.name} ({tenant.slug})
                            </option>
                        ))}
                    </select>
                    <select className={tableStyles.input} value={filters.actorEmail} onChange={(e) => setFilter('actorEmail', e.target.value)} aria-label={t('audit.filters.admin')}>
                        <option value="">{t('audit.filters.allAdmins')}</option>
                        {adminEmails.map((email) => (
                            <option key={email} value={email}>
                                {email}
                            </option>
                        ))}
                    </select>
                    <select className={tableStyles.input} value={filters.result} onChange={(e) => setFilter('result', e.target.value)} aria-label={t('audit.filters.result')}>
                        <option value="">{t('audit.filters.allResults')}</option>
                        {(['SUCCESS', 'FAILURE', 'REQUESTED'] as const).map((result) => (
                            <option key={result} value={result}>
                                {t(`audit.results.${result}`)}
                            </option>
                        ))}
                    </select>
                    <label className={styles.dateFilter}>
                        <span>{t('audit.filters.from')}</span>
                        <input type="date" className={tableStyles.input} value={filters.from} onChange={(e) => setFilter('from', e.target.value)} />
                    </label>
                    <label className={styles.dateFilter}>
                        <span>{t('audit.filters.to')}</span>
                        <input type="date" className={tableStyles.input} value={filters.to} onChange={(e) => setFilter('to', e.target.value)} />
                    </label>
                    {hasFilters && (
                        <button type="button" className={tableStyles.buttonSecondary} onClick={() => setFilters(emptyFilters)}>
                            <X size={14} aria-hidden />
                            {t('tenants.clearFilters')}
                        </button>
                    )}
                </div>

                {audit.status === 'loading' ? (
                    <div className={tableStyles.loadingState} aria-busy="true">
                        {t('audit.loading')}
                    </div>
                ) : audit.status === 'error' ? (
                    <section className={styles.stateCard} role="alert">
                        <AlertTriangle size={20} aria-hidden />
                        <div>
                            <h2>{audit.unavailable ? t('audit.unavailableTitle') : t('audit.loadFailed')}</h2>
                            <p>{audit.unavailable ? t('audit.unavailableText') : audit.message}</p>
                        </div>
                        <button type="button" className={tableStyles.buttonSecondary} onClick={() => loadAudit()}>
                            <RefreshCw size={16} aria-hidden />
                            {t('home.retry')}
                        </button>
                    </section>
                ) : audit.entries.length === 0 ? (
                    <div className={tableStyles.emptyState}>{hasFilters ? t('audit.noResults') : t('audit.empty')}</div>
                ) : (
                    <>
                        <div className={tableStyles.tableWrapper}>
                            <table className={tableStyles.table}>
                                <thead>
                                    <tr>
                                        <th>{t('audit.columns.date')}</th>
                                        <th>{t('audit.columns.actor')}</th>
                                        <th>{t('audit.columns.action')}</th>
                                        <th>{t('audit.columns.store')}</th>
                                        <th>{t('audit.columns.result')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {audit.entries.map((entry) => (
                                        <tr key={entry.id} data-audit-action={entry.action} data-audit-result={entry.result}>
                                            <td className={tableStyles.cellSub}>{formatDateTime(entry.createdAt)}</td>
                                            <td>{actorLabel(entry)}</td>
                                            <td>
                                                <div className={tableStyles.cellMain}>
                                                    <span className={tableStyles.cellTitle}>{actionLabel(entry.action)}</span>
                                                    {detailText(entry) && <span className={tableStyles.cellSub}>{detailText(entry)}</span>}
                                                </div>
                                            </td>
                                            <td>
                                                {entry.tenantId ? (
                                                    <div className={tableStyles.cellMain}>
                                                        <Link href={`/plataforma/tiendas/${entry.tenantId}`} className={styles.tenantLink}>
                                                            {entry.tenantName ?? entry.tenantSlug ?? entry.tenantId}
                                                        </Link>
                                                        {entry.tenantSlug && <span className={tableStyles.cellSub}>{entry.tenantSlug}</span>}
                                                    </div>
                                                ) : (
                                                    <span className={tableStyles.cellSub}>{entry.details?.scope === 'PLATFORM' ? tb('scopeBadge.platform') : '—'}</span>
                                                )}
                                            </td>
                                            <td>{resultCell(entry)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {audit.hasMore && (
                            <button
                                type="button"
                                className={tableStyles.buttonSecondary}
                                disabled={audit.loadingMore}
                                onClick={() => loadAudit(audit.entries[audit.entries.length - 1].createdAt)}
                            >
                                {audit.loadingMore ? t('audit.loading') : t('audit.loadMore')}
                            </button>
                        )}
                    </>
                )}
            </section>
        </div>
    );
}
