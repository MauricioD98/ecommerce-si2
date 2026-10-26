'use client';

import React, { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, KeyRound, LogOut, PauseCircle, PlayCircle, RefreshCw, RotateCcw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import tableStyles from '@/components/modules/admin/admin-table.module.scss';
import styles from './platform-admin.module.scss';
import LanguageSwitcher from '@/components/modules/i18n/LanguageSwitcher';
import { intlLocale } from '@/i18n/config';
import {
    PlatformApiError,
    PlatformMetrics,
    PlatformTenant,
    TenantStatus,
    platformAdminService,
} from '@/service/api/platformAdmin.service';

// Solo en esta pestaña: se borra al cerrarla. No va a localStorage (persistiría en el equipo).
// "Abrir" lleva a la tienda con ?tenant=<id>, que el front usa para elegirla (utils/tenant.ts).
const KEY_STORAGE = 'sf_platform_key';

const STATUS_BADGE: Record<TenantStatus, string> = {
    ACTIVE: tableStyles.badgeSuccess,
    SUSPENDED: tableStyles.badgeDanger,
    PROVISIONING: tableStyles.badgeInfo,
    FAILED: tableStyles.badgeWarning,
};

const SUBSCRIPTION_BADGE: Record<string, string> = {
    active: tableStyles.badgeSuccess,
    trialing: tableStyles.badgeInfo,
    past_due: tableStyles.badgeWarning,
    incomplete: tableStyles.badgeWarning,
    unpaid: tableStyles.badgeDanger,
    canceled: tableStyles.badgeDanger,
    incomplete_expired: tableStyles.badgeDanger,
    paused: tableStyles.badgeMuted,
};

const readStoredKey = (): string => {
    try {
        return sessionStorage.getItem(KEY_STORAGE) ?? '';
    } catch {
        return '';
    }
};

export default function PlatformAdminClient() {
    const t = useTranslations('PlatformAdmin');
    const tSub = useTranslations('AdminSubscription');
    const locale = useLocale();

    const [key, setKey] = useState('');
    const [keyInput, setKeyInput] = useState('');
    const [tenants, setTenants] = useState<PlatformTenant[]>([]);
    const [metrics, setMetrics] = useState<PlatformMetrics | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<TenantStatus | ''>('');

    useEffect(() => setKey(readStoredKey()), []);

    const signOut = useCallback(() => {
        try {
            sessionStorage.removeItem(KEY_STORAGE);
        } catch {
            // sin storage: igual se olvida en memoria
        }
        setKey('');
        setTenants([]);
        setMetrics(null);
    }, []);

    const load = useCallback(
        async (platformKey: string) => {
            setIsLoading(true);
            setError(null);
            try {
                const [tenantList, metricData] = await Promise.all([
                    platformAdminService.getTenants(platformKey),
                    platformAdminService.getMetrics(platformKey),
                ]);
                setTenants(tenantList);
                setMetrics(metricData);
            } catch (err) {
                // Llave incorrecta o revocada: se vuelve a pedir
                if (err instanceof PlatformApiError && err.status === 401) {
                    signOut();
                    setError(t('invalidKey'));
                } else {
                    setError(err instanceof Error ? err.message : t('loadFailed'));
                }
            } finally {
                setIsLoading(false);
            }
        },
        [signOut, t],
    );

    useEffect(() => {
        if (key) load(key);
    }, [key, load]);

    const handleKeySubmit = (e: FormEvent) => {
        e.preventDefault();
        const value = keyInput.trim();
        if (!value) return;
        try {
            sessionStorage.setItem(KEY_STORAGE, value);
        } catch {
            // sin storage: la llave vive solo mientras la página esté abierta
        }
        setKeyInput('');
        setKey(value);
    };

    const changeStatus = async (tenant: PlatformTenant, status: 'ACTIVE' | 'SUSPENDED') => {
        const question = status === 'SUSPENDED' ? t('confirmSuspend', { name: tenant.name }) : t('confirmReactivate', { name: tenant.name });
        if (!window.confirm(question)) return;

        setBusyId(tenant.id);
        setError(null);
        setNotice(null);
        try {
            await platformAdminService.setStatus(key, tenant.id, status);
            setNotice(status === 'SUSPENDED' ? t('suspended', { name: tenant.name }) : t('reactivated', { name: tenant.name }));
            await load(key);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('actionFailed'));
        } finally {
            setBusyId(null);
        }
    };

    const retry = async (tenant: PlatformTenant) => {
        setBusyId(tenant.id);
        setError(null);
        setNotice(null);
        try {
            await platformAdminService.retry(key, tenant.id);
            setNotice(t('retried', { name: tenant.name }));
            await load(key);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('actionFailed'));
        } finally {
            setBusyId(null);
        }
    };

    const visibleTenants = useMemo(() => {
        const term = search.trim().toLowerCase();
        return tenants.filter(
            (tenant) =>
                (!statusFilter || tenant.status === statusFilter) &&
                (!term ||
                    [tenant.name, tenant.slug, tenant.domain, tenant.ownerEmail].some((value) => value?.toLowerCase().includes(term))),
        );
    }, [tenants, search, statusFilter]);

    const formatDate = (value: string) =>
        new Date(value).toLocaleDateString(intlLocale(locale), { day: '2-digit', month: 'short', year: 'numeric' });
    const formatMrr = (value: number, currency: string) =>
        new Intl.NumberFormat(intlLocale(locale), { style: 'currency', currency }).format(value);

    // ------------------------------------------------------------------ Llave de plataforma
    if (!key) {
        return (
            <div className={styles.gate}>
                <form className={styles.gateCard} onSubmit={handleKeySubmit}>
                    <KeyRound size={28} aria-hidden />
                    <h1>{t('gateTitle')}</h1>
                    <p>{t('gateText')}</p>
                    {error && <div className={tableStyles.errorMessage}>{error}</div>}
                    <label className={tableStyles.field}>
                        <span>{t('keyLabel')}</span>
                        <input
                            type="password"
                            className={tableStyles.input}
                            value={keyInput}
                            onChange={(e) => setKeyInput(e.target.value)}
                            autoComplete="off"
                            autoFocus
                        />
                    </label>
                    <button type="submit" className={tableStyles.button} disabled={!keyInput.trim()}>
                        {t('enter')}
                    </button>
                    <small>{t('keyHint')}</small>
                </form>
            </div>
        );
    }

    // ------------------------------------------------------------------ Panel
    const kpis = metrics
        ? [
              { label: t('kpi.active'), value: String(metrics.active), hint: t('kpi.activeHint', { total: metrics.total }) },
              { label: t('kpi.mrr'), value: formatMrr(metrics.mrr, metrics.currency), hint: t('kpi.mrrHint', { count: metrics.payingTenants }) },
              { label: t('kpi.suspended'), value: String(metrics.suspended), hint: t('kpi.suspendedHint') },
              {
                  label: t('kpi.attention'),
                  value: String(metrics.provisioning + metrics.failed),
                  hint: t('kpi.attentionHint', { failed: metrics.failed, provisioning: metrics.provisioning }),
              },
          ]
        : [];

    return (
        <div className={styles.shell}>
            <header className={styles.topbar}>
                <span className={styles.brand}>STELLA FEMME · {t('brandSuffix')}</span>
                <div className={styles.topbarActions}>
                    <LanguageSwitcher />
                    <button type="button" className={tableStyles.buttonSecondary} onClick={() => load(key)} disabled={isLoading}>
                        <RefreshCw size={16} className={isLoading ? styles.spin : ''} />
                        {t('refresh')}
                    </button>
                    <button type="button" className={tableStyles.buttonSecondary} onClick={signOut}>
                        <LogOut size={16} />
                        {t('signOut')}
                    </button>
                </div>
            </header>

            <main className={`${tableStyles.page} ${styles.content}`}>
                <div className={tableStyles.pageHeader}>
                    <div>
                        <h1>{t('title')}</h1>
                        <p>{t('subtitle')}</p>
                    </div>
                </div>

                {error && <div className={tableStyles.errorMessage}>{error}</div>}
                {notice && <div className={tableStyles.successMessage}>{notice}</div>}

                <div className={tableStyles.statGrid}>
                    {kpis.map((kpi) => (
                        <div key={kpi.label} className={tableStyles.statCard}>
                            <span className={tableStyles.statLabel}>{kpi.label}</span>
                            <span className={tableStyles.statValue}>{kpi.value}</span>
                            <span className={tableStyles.cellSub}>{kpi.hint}</span>
                        </div>
                    ))}
                </div>

                <div className={styles.filters}>
                    <input
                        className={tableStyles.input}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t('searchPlaceholder')}
                        aria-label={t('searchPlaceholder')}
                    />
                    <select
                        className={tableStyles.input}
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value as TenantStatus | '')}
                        aria-label={t('statusFilter')}
                    >
                        <option value="">{t('allStatuses')}</option>
                        {(['ACTIVE', 'SUSPENDED', 'PROVISIONING', 'FAILED'] as const).map((status) => (
                            <option key={status} value={status}>{t(`statuses.${status}`)}</option>
                        ))}
                    </select>
                </div>

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
                                        const busy = busyId === tenant.id;
                                        const subscription = tenant.subscriptionStatus;
                                        return (
                                            <tr key={tenant.id}>
                                                <td>
                                                    <div className={tableStyles.cellMain}>
                                                        <span className={tableStyles.cellTitle}>{tenant.name}</span>
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
                                                    <span className={tableStyles.badge}>{tenant.plan}</span>
                                                </td>
                                                <td>
                                                    {subscription ? (
                                                        <span className={`${tableStyles.badge} ${SUBSCRIPTION_BADGE[subscription] ?? tableStyles.badgeMuted}`}>
                                                            {subscription in SUBSCRIPTION_BADGE
                                                                ? tSub(`statuses.${subscription as 'active'}`)
                                                                : subscription}
                                                        </span>
                                                    ) : (
                                                        <span className={tableStyles.cellSub}>{t('noSubscription')}</span>
                                                    )}
                                                </td>
                                                <td>
                                                    <span className={`${tableStyles.badge} ${STATUS_BADGE[tenant.status]}`}>
                                                        {t(`statuses.${tenant.status}`)}
                                                    </span>
                                                </td>
                                                <td className={tableStyles.cellSub}>{formatDate(tenant.createdAt)}</td>
                                                <td>
                                                    <div className={tableStyles.actions}>
                                                        {tenant.status === 'ACTIVE' && (
                                                            <button
                                                                type="button"
                                                                className={tableStyles.buttonDanger}
                                                                disabled={busy}
                                                                onClick={() => changeStatus(tenant, 'SUSPENDED')}
                                                            >
                                                                <PauseCircle size={14} />
                                                                {t('suspend')}
                                                            </button>
                                                        )}
                                                        {tenant.status === 'SUSPENDED' && (
                                                            <button
                                                                type="button"
                                                                className={tableStyles.button}
                                                                disabled={busy}
                                                                onClick={() => changeStatus(tenant, 'ACTIVE')}
                                                            >
                                                                <PlayCircle size={14} />
                                                                {t('reactivate')}
                                                            </button>
                                                        )}
                                                        {tenant.status === 'FAILED' && (
                                                            <button
                                                                type="button"
                                                                className={tableStyles.buttonSecondary}
                                                                disabled={busy}
                                                                onClick={() => retry(tenant)}
                                                            >
                                                                <RotateCcw size={14} />
                                                                {t('retry')}
                                                            </button>
                                                        )}
                                                        {tenant.status === 'ACTIVE' && (
                                                            <a
                                                                className={tableStyles.buttonSecondary}
                                                                href={`/?tenant=${encodeURIComponent(tenant.id)}`}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                            >
                                                                <ExternalLink size={14} />
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
                <p className={tableStyles.cellSub}>{t('mrrNote')}</p>
            </main>
        </div>
    );
}
