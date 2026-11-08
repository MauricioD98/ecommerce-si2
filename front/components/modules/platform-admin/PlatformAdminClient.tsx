'use client';

import React, { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ExternalLink, Lock, LogOut, PauseCircle, PlayCircle, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
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

// La sesión (token + email) vive solo en esta pestaña: se borra al cerrarla. No va a localStorage
// (persistiría en el equipo). "Abrir" lleva a la tienda con ?tenant=<id> (utils/tenant.ts).
const SESSION_STORAGE = 'sf_platform_session';

interface StoredSession {
    token: string;
    email: string;
}

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

const PLAN_BADGE: Record<string, string> = {
    starter: tableStyles.badgeInfo,
    growth: tableStyles.badgeSuccess,
    pro: tableStyles.badgeWarning,
};

const PLAN_LABEL: Record<string, string> = {
    starter: 'Starter',
    growth: 'Growth',
    pro: 'Pro',
    free: 'Gratuito',
    legacy: 'Legacy',
};

const readStoredSession = (): StoredSession | null => {
    try {
        const parsed = JSON.parse(sessionStorage.getItem(SESSION_STORAGE) ?? 'null');
        return typeof parsed?.token === 'string' && typeof parsed?.email === 'string' ? parsed : null;
    } catch {
        return null;
    }
};

export default function PlatformAdminClient() {
    const t = useTranslations('PlatformAdmin');
    const tSub = useTranslations('AdminSubscription');
    const locale = useLocale();

    const [session, setSession] = useState<StoredSession | null>(null);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [isSigningIn, setIsSigningIn] = useState(false);
    const [tenants, setTenants] = useState<PlatformTenant[]>([]);
    const [metrics, setMetrics] = useState<PlatformMetrics | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<TenantStatus | ''>('');

    // sessionStorage solo existe en el navegador: se lee al montar (no durante el render del servidor)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => setSession(readStoredSession()), []);
    const token = session?.token ?? '';

    const signOut = useCallback(() => {
        try {
            sessionStorage.removeItem(SESSION_STORAGE);
        } catch {
            // sin storage: igual se olvida en memoria
        }
        setSession(null);
        setTenants([]);
        setMetrics(null);
    }, []);

    const load = useCallback(
        async (sessionToken: string) => {
            setIsLoading(true);
            setError(null);
            try {
                const [tenantList, metricData] = await Promise.all([
                    platformAdminService.getTenants(sessionToken),
                    platformAdminService.getMetrics(sessionToken),
                ]);
                setTenants(tenantList);
                setMetrics(metricData);
            } catch (err) {
                // Sesión vencida o cuenta desactivada: se vuelve a pedir el login
                if (err instanceof PlatformApiError && err.status === 401) {
                    signOut();
                    setError(t('sessionExpired'));
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
        // Carga al iniciar sesión: los setState ocurren después del await dentro de load
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (token) load(token);
    }, [token, load]);

    const handleLogin = async (e: FormEvent) => {
        e.preventDefault();
        if (!email.trim() || !password) return;
        setIsSigningIn(true);
        setError(null);
        try {
            const { accessToken, admin } = await platformAdminService.login(email.trim(), password);
            const next = { token: accessToken, email: admin.email };
            try {
                sessionStorage.setItem(SESSION_STORAGE, JSON.stringify(next));
            } catch {
                // sin storage: la sesión vive solo mientras la página esté abierta
            }
            setPassword('');
            setSession(next);
        } catch (err) {
            // La API ya responde el motivo traducido (credenciales inválidas, cuenta bloqueada…)
            setError(err instanceof Error && err.message ? err.message : t('loginFailed'));
        } finally {
            setIsSigningIn(false);
        }
    };

    const changeStatus = async (tenant: PlatformTenant, status: 'ACTIVE' | 'SUSPENDED') => {
        const question = status === 'SUSPENDED' ? t('confirmSuspend', { name: tenant.name }) : t('confirmReactivate', { name: tenant.name });
        if (!window.confirm(question)) return;

        setBusyId(tenant.id);
        setError(null);
        setNotice(null);
        try {
            await platformAdminService.setStatus(token, tenant.id, status);
            setNotice(status === 'SUSPENDED' ? t('suspended', { name: tenant.name }) : t('reactivated', { name: tenant.name }));
            await load(token);
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
            await platformAdminService.retry(token, tenant.id);
            setNotice(t('retried', { name: tenant.name }));
            await load(token);
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

    // ------------------------------------------------------------------ Login de plataforma
    if (!session) {
        return (
            <div className={styles.gate}>
                <section aria-label={t('gateTitle')} className={styles.gateIntro}>
                    <div className={styles.gateBadge}>
                        <ShieldCheck size={22} aria-hidden />
                        {t('restricted')}
                    </div>
                    <div>
                        <h1>{t('gateTitle')}</h1>
                        <p>{t('gateText')}</p>
                    </div>
                    <div className={styles.gateRule} aria-hidden />
                </section>

                <main className={styles.gateMain}>
                    <form className={styles.gateForm} onSubmit={handleLogin} noValidate>
                        <h2>{t('signInTitle')}</h2>
                        {error && (
                            <div role="alert" className={styles.gateError}>
                                <AlertCircle size={18} aria-hidden />
                                <span>{error}</span>
                            </div>
                        )}
                        <div>
                            <label className={styles.gateLabel} htmlFor="platform-email">
                                {t('emailLabel')}
                            </label>
                            <input
                                id="platform-email"
                                type="email"
                                className={styles.gateInput}
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder={t('emailPlaceholder')}
                                autoComplete="username"
                                autoFocus
                                required
                            />
                        </div>
                        <div>
                            <label className={styles.gateLabel} htmlFor="platform-password">
                                {t('passwordLabel')}
                            </label>
                            <div className={styles.gatePassword}>
                                <input
                                    id="platform-password"
                                    type={showPassword ? 'text' : 'password'}
                                    className={styles.gateInput}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    autoComplete="current-password"
                                    required
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword((v) => !v)}
                                    aria-pressed={showPassword}
                                    aria-label={showPassword ? t('hidePasswordLabel') : t('showPasswordLabel')}
                                >
                                    {showPassword ? t('hidePassword') : t('showPassword')}
                                </button>
                            </div>
                        </div>
                        <button type="submit" className={styles.gateSubmit} disabled={isSigningIn || !email.trim() || !password}>
                            {isSigningIn ? t('signingIn') : t('enter')}
                        </button>
                        <div className={styles.gateNote}>
                            <Lock size={18} aria-hidden />
                            <span>{t('loginHint')}</span>
                        </div>
                    </form>
                </main>
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
                <span className={styles.brand}>NovaSoft · {t('brandSuffix')}</span>
                <div className={styles.topbarActions}>
                    <span className={tableStyles.cellSub}>{session.email}</span>
                    <LanguageSwitcher />
                    <button type="button" className={tableStyles.buttonSecondary} onClick={() => load(token)} disabled={isLoading}>
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
                                                    <span className={`${tableStyles.badge} ${PLAN_BADGE[tenant.plan?.toLowerCase()] ?? tableStyles.badgeMuted}`}>
                                                        {PLAN_LABEL[tenant.plan?.toLowerCase()] ?? tenant.plan}
                                                    </span>
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
