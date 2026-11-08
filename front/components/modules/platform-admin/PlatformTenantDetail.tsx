'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, ArrowLeft, ArrowRight, ExternalLink, PauseCircle, PlayCircle, RefreshCw, RotateCcw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import tableStyles from '@/components/modules/admin/admin-table.module.scss';
import styles from './platform-admin.module.scss';
import { intlLocale } from '@/i18n/config';
import { PlatformApiError, type PlatformTenantDetail as Detail, platformAdminService } from '@/service/api/platformAdmin.service';
import type { BackupJob } from '@/types/backup.types';
import { usePlatformAdmin } from './PlatformAdminContext';
import TenantActionDialog, { type TenantActionKind } from './TenantActionDialog';
import { KNOWN_SUBSCRIPTION_STATUSES, PLAN_NAMES, STATUS_BADGE, SUBSCRIPTION_BADGE, normalizePlan } from './tenantDisplay';

// Detalle de una tienda con lo que el plano de control ya sabe de ella. No entra a la cuenta del dueño
// ni lo suplanta: el soporte asistido queda como pendiente.

const RECENT_BACKUPS = 5;

type LoadState = { status: 'loading' } | { status: 'ready'; tenant: Detail } | { status: 'notFound' } | { status: 'error'; message: string };
type BackupState = { status: 'loading' } | { status: 'ready'; jobs: BackupJob[] } | { status: 'error'; message: string };

export default function PlatformTenantDetail({ tenantId }: { tenantId: string }) {
    const t = useTranslations('PlatformAdmin');
    const tb = useTranslations('Backups');
    const tSub = useTranslations('AdminSubscription');
    const locale = useLocale();
    const params = useSearchParams();
    const { token, reload, reportError } = usePlatformAdmin();

    const [state, setState] = useState<LoadState>({ status: 'loading' });
    const [backups, setBackups] = useState<BackupState>({ status: 'loading' });
    const [action, setAction] = useState<TenantActionKind | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    // Vuelve a la lista con los mismos filtros con que se abrió el detalle
    const back = params.get('volver');
    const backHref = `/plataforma/tiendas${back ? `?${back}` : ''}`;

    const load = useCallback(async () => {
        setState((prev) => (prev.status === 'ready' ? prev : { status: 'loading' }));
        try {
            const tenant = await platformAdminService.getTenant(token, tenantId);
            setState({ status: 'ready', tenant });
        } catch (err) {
            if (err instanceof PlatformApiError && err.status === 401) return reportError(err, t('loadFailed'));
            // 400 = el id no es un UUID; 404 = no existe
            if (err instanceof PlatformApiError && (err.status === 404 || err.status === 400)) return setState({ status: 'notFound' });
            setState({ status: 'error', message: err instanceof Error && err.message ? err.message : t('loadFailed') });
        }
    }, [token, tenantId, reportError, t]);

    const loadBackups = useCallback(async () => {
        setBackups({ status: 'loading' });
        try {
            setBackups({ status: 'ready', jobs: await platformAdminService.getTenantBackups(token, tenantId) });
        } catch (err) {
            if (err instanceof PlatformApiError && err.status === 401) return reportError(err, t('loadFailed'));
            setBackups({ status: 'error', message: err instanceof Error && err.message ? err.message : t('home.backups.loadFailed') });
        }
    }, [token, tenantId, reportError, t]);

    useEffect(() => {
        if (!token) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        load();
        loadBackups();
    }, [token, load, loadBackups]);

    const formatDate = (value: string) =>
        new Date(value).toLocaleString(intlLocale(locale), { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const planLabel = (plan: string) => {
        const key = normalizePlan(plan);
        if (PLAN_NAMES[key]) return PLAN_NAMES[key];
        if (key === 'free' || key === 'legacy') return t(`tenants.plans.${key}`);
        return plan || t('tenants.plans.none');
    };
    const yesNo = (value: boolean) => (value ? t('tenants.detail.yes') : t('tenants.detail.no'));

    const backLink = (
        <Link href={backHref} className={styles.panelLink}>
            <ArrowLeft size={16} aria-hidden />
            {t('tenants.detail.back')}
        </Link>
    );

    if (state.status === 'loading') {
        return (
            <div className={tableStyles.page}>
                {backLink}
                <div className={tableStyles.loadingState} aria-busy="true">
                    {t('tenants.detail.loading')}
                </div>
            </div>
        );
    }
    if (state.status === 'notFound' || state.status === 'error') {
        return (
            <div className={tableStyles.page}>
                {backLink}
                <section className={styles.stateCard} role="alert">
                    <AlertTriangle size={20} aria-hidden />
                    <div>
                        <h2>{state.status === 'notFound' ? t('tenants.detail.notFound') : t('tenants.detail.loadFailed')}</h2>
                        {state.status === 'error' && <p>{state.message}</p>}
                    </div>
                    {state.status === 'error' && (
                        <button type="button" className={tableStyles.buttonSecondary} onClick={() => load()}>
                            <RefreshCw size={16} aria-hidden />
                            {t('home.retry')}
                        </button>
                    )}
                </section>
            </div>
        );
    }

    const tenant = state.tenant;
    const sub = tenant.subscriptionStatus;
    const subLabel = sub
        ? (KNOWN_SUBSCRIPTION_STATUSES as string[]).includes(sub)
            ? tSub(`statuses.${sub as 'active'}`)
            : sub
        : null;
    const integrationNames: Record<string, string> = { DECART: t('tenants.detail.integrationDecart'), WEBPUSH: t('tenants.detail.integrationWebPush') };

    return (
        <div className={tableStyles.page}>
            {backLink}

            <div className={tableStyles.pageHeader}>
                <div>
                    <h1>{tenant.name}</h1>
                    <p>
                        <code>{tenant.slug}</code> · {tenant.domain ?? t('tenants.detail.noDomain')}
                    </p>
                </div>
                <span className={`${tableStyles.badge} ${STATUS_BADGE[tenant.status]}`}>{t(`statuses.${tenant.status}`)}</span>
            </div>

            {notice && (
                <div className={tableStyles.successMessage} role="status">
                    {notice}
                </div>
            )}

            {/* ------------------------------------------------ Acciones */}
            <section className={styles.panel} aria-labelledby="tenant-actions">
                <h2 id="tenant-actions">{t('tenants.detail.actionsTitle')}</h2>
                <div className={tableStyles.toolbar}>
                    {tenant.status === 'ACTIVE' && (
                        <button type="button" className={tableStyles.buttonDanger} onClick={() => setAction('suspend')}>
                            <PauseCircle size={16} aria-hidden />
                            {t('suspend')}
                        </button>
                    )}
                    {tenant.status === 'SUSPENDED' && (
                        <button type="button" className={tableStyles.button} onClick={() => setAction('reactivate')}>
                            <PlayCircle size={16} aria-hidden />
                            {t('reactivate')}
                        </button>
                    )}
                    {tenant.status === 'FAILED' && (
                        <button type="button" className={tableStyles.buttonSecondary} onClick={() => setAction('retry')}>
                            <RotateCcw size={16} aria-hidden />
                            {t('retry')}
                        </button>
                    )}
                    {tenant.status === 'ACTIVE' && (
                        <a className={tableStyles.buttonSecondary} href={`/?tenant=${encodeURIComponent(tenant.id)}`} target="_blank" rel="noopener noreferrer">
                            <ExternalLink size={16} aria-hidden />
                            {t('open')}
                        </a>
                    )}
                    {tenant.status === 'PROVISIONING' && <p className={tableStyles.cellSub}>{t('tenants.detail.provisioningNoActions')}</p>}
                </div>
                {tenant.status === 'ACTIVE' && <p className={tableStyles.cellSub}>{t('tenants.openStorefrontHint')}</p>}
                <p className={styles.inlineNotice}>{t('tenants.detail.supportPending')}</p>
            </section>

            {/* ------------------------------------------------ Datos generales */}
            <section className={styles.panel} aria-labelledby="tenant-general">
                <h2 id="tenant-general">{t('tenants.detail.generalTitle')}</h2>
                <dl className={styles.factList}>
                    <Fact label={t('tenants.detail.owner')} value={tenant.ownerEmail ?? t('noOwner')} />
                    <Fact label={t('columns.plan')} value={planLabel(tenant.plan)} />
                    <Fact label={t('columns.created')} value={formatDate(tenant.createdAt)} />
                    <Fact label={t('tenants.detail.updatedAt')} value={formatDate(tenant.updatedAt)} />
                    <Fact label={t('tenants.detail.slug')} value={tenant.slug} mono />
                    <Fact label={t('tenants.detail.id')} value={tenant.id} mono />
                    <Fact
                        label={t('tenants.detail.domain')}
                        value={
                            tenant.domain
                                ? `${tenant.domain} · ${tenant.domainVerifiedAt ? t('tenants.detail.domainVerified') : t('tenants.detail.domainUnverified')}`
                                : t('tenants.detail.noDomain')
                        }
                    />
                    <Fact label={t('tenants.detail.schemaVersion')} value={tenant.schemaVersion ?? t('home.noData')} mono={!!tenant.schemaVersion} />
                </dl>
                {tenant.provisionError && (
                    <p className={tableStyles.rowError}>
                        {t('tenants.detail.provisionError')}: {tenant.provisionError}
                    </p>
                )}
            </section>

            {/* ------------------------------------------------ Suscripción y cobros */}
            <section className={styles.panel} aria-labelledby="tenant-subscription">
                <h2 id="tenant-subscription">{t('tenants.detail.subscriptionTitle')}</h2>
                <dl className={styles.factList}>
                    <div>
                        <dt>{t('columns.subscription')}</dt>
                        <dd>
                            {subLabel ? (
                                <span className={`${tableStyles.badge} ${SUBSCRIPTION_BADGE[sub ?? ''] ?? tableStyles.badgeMuted}`}>{subLabel}</span>
                            ) : (
                                t('noSubscription')
                            )}
                        </dd>
                    </div>
                    <Fact label={t('tenants.detail.connectAccount')} value={yesNo(tenant.hasStripeAccount)} />
                    <Fact label={t('tenants.detail.chargesEnabled')} value={yesNo(tenant.stripeChargesEnabled)} />
                    <Fact
                        label={t('tenants.detail.platformFee')}
                        value={new Intl.NumberFormat(intlLocale(locale), { style: 'percent', maximumFractionDigits: 2 }).format(tenant.platformFeeBps / 10000)}
                    />
                </dl>
                <Link href={`/plataforma/planes?q=${encodeURIComponent(tenant.slug)}`} className={styles.panelLink}>
                    {t('tenants.detail.subscriptionLink')}
                    <ArrowRight size={16} aria-hidden />
                </Link>
            </section>

            {/* ------------------------------------------------ Integraciones */}
            <section className={styles.panel} aria-labelledby="tenant-integrations">
                <h2 id="tenant-integrations">{t('tenants.detail.integrationsTitle')}</h2>
                {tenant.integrations.length === 0 ? (
                    <p className={tableStyles.cellSub}>{t('tenants.detail.noIntegrations')}</p>
                ) : (
                    <ul className={styles.attentionList}>
                        {tenant.integrations.map((integration) => (
                            <li key={integration.provider} className={styles.jobRow}>
                                <span className={tableStyles.cellTitle}>{integrationNames[integration.provider] ?? integration.provider}</span>
                                <span className={tableStyles.cellSub}>{t('tenants.detail.configuredAt', { date: formatDate(integration.updatedAt) })}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            {/* ------------------------------------------------ Sucursales */}
            <section className={styles.panel} aria-labelledby="tenant-branches">
                <h2 id="tenant-branches">{t('nav.branches')}</h2>
                <p className={tableStyles.cellSub}>{t('tenants.detail.branchesText')}</p>
                {tenant.status === 'ACTIVE' || tenant.status === 'SUSPENDED' ? (
                    <Link href={`/plataforma/sucursales?tienda=${encodeURIComponent(tenant.id)}`} className={styles.panelLink}>
                        {t('tenants.detail.branchesLink')}
                        <ArrowRight size={16} aria-hidden />
                    </Link>
                ) : (
                    <p className={tableStyles.cellSub}>{t('branches.notProvisioned')}</p>
                )}
            </section>

            {/* ------------------------------------------------ Respaldos de esta tienda */}
            <section className={styles.panel} aria-labelledby="tenant-backups">
                <h2 id="tenant-backups">{t('tenants.detail.backupsTitle')}</h2>
                {backups.status === 'loading' ? (
                    <p className={tableStyles.cellSub} aria-busy="true">
                        {t('home.backups.loading')}
                    </p>
                ) : backups.status === 'error' ? (
                    <div className={styles.inlineError} role="alert">
                        <span>{t('home.backups.unavailable', { reason: backups.message })}</span>
                        <button type="button" className={tableStyles.buttonSecondary} onClick={() => loadBackups()}>
                            <RefreshCw size={14} aria-hidden />
                            {t('home.retry')}
                        </button>
                    </div>
                ) : backups.jobs.length === 0 ? (
                    <p className={tableStyles.cellSub}>{t('tenants.detail.noBackups')}</p>
                ) : (
                    <ul className={styles.attentionList}>
                        {backups.jobs.slice(0, RECENT_BACKUPS).map((job) => (
                            <li key={job.id} className={styles.jobRow}>
                                <div className={tableStyles.cellMain}>
                                    <span className={tableStyles.cellTitle}>{tb(`kind.${job.kind}`)}</span>
                                    <span className={tableStyles.cellSub}>{formatDate(job.createdAt)}</span>
                                </div>
                                <span className={`${tableStyles.badge} ${job.status === 'FAILED' ? tableStyles.badgeDanger : tableStyles.badgeMuted}`}>
                                    {tb(`status.${job.status}`)}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
                <p className={tableStyles.cellSub}>{t('tenants.detail.backupsHint')}</p>
                <Link href={`/plataforma/respaldos?tienda=${encodeURIComponent(tenant.id)}`} className={styles.panelLink}>
                    {t('home.backups.goTo')}
                    <ArrowRight size={16} aria-hidden />
                </Link>
            </section>

            {action && (
                <TenantActionDialog
                    kind={action}
                    tenant={tenant}
                    onClose={() => setAction(null)}
                    onDone={async (message) => {
                        setAction(null);
                        setNotice(message);
                        await Promise.all([load(), reload()]);
                    }}
                />
            )}
        </div>
    );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
    return (
        <div>
            <dt>{label}</dt>
            <dd>{mono ? <code>{value}</code> : value}</dd>
        </div>
    );
}

