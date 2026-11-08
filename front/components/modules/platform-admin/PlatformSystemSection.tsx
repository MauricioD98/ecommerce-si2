'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import tableStyles from '@/components/modules/admin/admin-table.module.scss';
import styles from './platform-admin.module.scss';
import { intlLocale } from '@/i18n/config';
import {
    PlatformApiError,
    type PlatformSystemStatus,
    type SystemCheck,
    type SystemCheckStatus,
    platformAdminService,
} from '@/service/api/platformAdmin.service';
import { usePlatformAdmin } from './PlatformAdminContext';

// Estado del sistema: cada tarjeta muestra una comprobación REAL hecha por la API al consultar (con su hora).
// Si la comprobación no se pudo hacer, "No disponible". No hay indicadores verdes supuestos: la conexión con
// Stripe o con el correo no se comprueba desde acá y se informa así.

type LoadState = { status: 'loading' } | { status: 'ready'; data: PlatformSystemStatus } | { status: 'error'; message: string; missingApi: boolean };

const BADGE: Record<SystemCheckStatus, string> = {
    ok: tableStyles.badgeSuccess,
    warning: tableStyles.badgeWarning,
    error: tableStyles.badgeDanger,
    unavailable: tableStyles.badgeMuted,
};

export default function PlatformSystemSection() {
    const t = useTranslations('PlatformAdmin');
    const locale = useLocale();
    const { token, loadedAt, reportError } = usePlatformAdmin();
    const [state, setState] = useState<LoadState>({ status: 'loading' });
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async () => {
        if (!token) return;
        setRefreshing(true);
        try {
            setState({ status: 'ready', data: await platformAdminService.getSystemStatus(token) });
        } catch (err) {
            if (err instanceof PlatformApiError && err.status === 401) return reportError(err, t('loadFailed'));
            setState({
                status: 'error',
                message: err instanceof Error && err.message ? err.message : t('system.loadFailed'),
                missingApi: err instanceof PlatformApiError && err.status === 404,
            });
        } finally {
            setRefreshing(false);
        }
    }, [token, reportError, t]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        load();
    }, [load, loadedAt]);

    const dateTime = (value: string | null | undefined) =>
        value ? new Date(value).toLocaleString(intlLocale(locale), { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null;
    const num = (value: number) => new Intl.NumberFormat(intlLocale(locale)).format(value);
    const duration = (seconds: number) => {
        const d = Math.floor(seconds / 86400);
        const h = Math.floor((seconds % 86400) / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        return d > 0 ? t('system.duration.days', { d, h }) : h > 0 ? t('system.duration.hours', { h, m }) : t('system.duration.minutes', { m: Math.max(m, 0), s: seconds % 60 });
    };

    const header = (
        <div className={tableStyles.pageHeader}>
            <div>
                <h1>{t('nav.system')}</h1>
                <p>{t('system.subtitle')}</p>
            </div>
            <button type="button" className={tableStyles.buttonSecondary} onClick={() => load()} disabled={refreshing}>
                <RefreshCw size={16} aria-hidden className={refreshing ? styles.spin : ''} />
                {t('system.recheck')}
            </button>
        </div>
    );

    if (state.status === 'loading') {
        return (
            <div className={tableStyles.page}>
                {header}
                <div className={tableStyles.loadingState} aria-busy="true">
                    {t('system.loading')}
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
                        {/* Si ni siquiera responde el estado, no se puede afirmar nada: todo queda "no disponible" */}
                        <h2>{state.missingApi ? t('system.missingApiTitle') : t('system.loadFailed')}</h2>
                        <p>{state.missingApi ? t('system.missingApiText') : state.message}</p>
                    </div>
                </section>
            </div>
        );
    }

    const s = state.data;

    // Tarjeta de una comprobación: estado (texto), hora de la comprobación y contenido
    const card = <T,>(id: string, title: string, check: SystemCheck<T>, body: (data: T) => React.ReactNode, okLabel?: string) => (
        <section className={styles.systemCard} aria-labelledby={`sys-${id}`} data-check={id} data-status={check.status}>
            <div className={styles.systemCardHead}>
                <h2 id={`sys-${id}`}>{title}</h2>
                <span className={`${tableStyles.badge} ${BADGE[check.status]}`}>
                    {check.status === 'ok' && okLabel ? okLabel : t(`system.status.${check.status}`)}
                </span>
            </div>
            {check.status === 'unavailable' || !check.data ? (
                <p className={styles.statMissing}>{t('home.unavailable')}</p>
            ) : (
                body(check.data)
            )}
            <p className={tableStyles.cellSub}>{t('system.checkedAt', { date: dateTime(check.checkedAt) ?? '—' })}</p>
        </section>
    );
    const fact = (label: string, value: React.ReactNode) => (
        <div>
            <dt>{label}</dt>
            <dd>{value}</dd>
        </div>
    );
    const none = <span className={tableStyles.cellSub}>{t('home.noData')}</span>;

    return (
        <div className={tableStyles.page}>
            {header}
            <p className={styles.inlineNotice}>{t('system.honestNote')}</p>

            <div className={styles.systemGrid}>
                {card('api', t('system.api.title'), s.api, (d) => (
                    <dl className={styles.factList}>
                        {fact(t('system.api.responding'), t('system.api.yes'))}
                        {fact(t('system.api.uptime'), duration(d.uptimeSeconds))}
                        {fact(t('system.api.startedAt'), dateTime(d.startedAt))}
                    </dl>
                ), t('system.api.okLabel'))}

                {card('database', t('system.database.title'), s.database, (d) => (
                    <dl className={styles.factList}>
                        {fact(t('system.database.query'), t('system.database.answered'))}
                        {fact(t('system.database.latency'), `${num(d.latencyMs)} ms`)}
                    </dl>
                ), t('system.database.okLabel'))}

                {card('migrations', t('system.migrations.title'), s.migrations, (d) => (
                    <>
                        <dl className={styles.factList}>
                            {fact(t('system.migrations.controlApplied'), num(d.control.applied))}
                            {fact(t('system.migrations.controlPending'), d.control.pending === null ? t('home.unavailable') : num(d.control.pending))}
                            {fact(t('system.migrations.controlFailed'), num(d.control.failed))}
                            {fact(
                                t('system.migrations.storesOutdated'),
                                d.tenants.outdated === null ? t('home.unavailable') : t('system.migrations.storesOutdatedValue', { outdated: d.tenants.outdated, total: d.tenants.total }),
                            )}
                        </dl>
                        {d.tenants.outdatedStores.length > 0 && (
                            <ul className={styles.attentionList}>
                                {d.tenants.outdatedStores.map((store) => (
                                    <li key={store.id}>
                                        <Link href={`/plataforma/tiendas/${store.id}`} className={styles.tenantLink}>
                                            {store.name}
                                        </Link>{' '}
                                        <span className={tableStyles.cellSub}>{store.unknownVersion ? t('system.migrations.unknownVersion') : store.slug}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </>
                ), t('system.migrations.okLabel'))}

                {card('backups', t('system.backups.title'), s.backups, (d) => (
                    <>
                        <dl className={styles.factList}>
                            {fact(t('system.backups.key'), d.keyConfigured ? t('system.configured') : t('system.notConfigured'))}
                            {fact(t('system.backups.active'), num(d.active))}
                            {fact(t('system.backups.stuck'), num(d.stuck))}
                            {fact(t('system.backups.last7'), t('system.backups.last7Value', { ok: d.succeededLast7Days, failed: d.failedLast7Days }))}
                            {fact(t('system.backups.lastSuccess'), dateTime(d.lastSuccessAt) ?? none)}
                            {fact(t('system.backups.lastPlatform'), dateTime(d.lastPlatformSuccessAt) ?? none)}
                            {fact(
                                t('system.backups.lastFailure'),
                                d.lastFailure ? `${dateTime(d.lastFailure.at) ?? '—'}${d.lastFailure.errorCode ? ` · ${d.lastFailure.errorCode}` : ''}` : t('system.none'),
                            )}
                        </dl>
                        <Link href="/plataforma/respaldos" className={styles.panelLink}>
                            {t('home.backups.goTo')}
                        </Link>
                    </>
                ), t('system.backups.okLabel'))}

                {card('externalSync', t('system.sync.title'), s.externalSync, (d) => (
                    <>
                        <dl className={styles.factList}>
                            {fact(t('system.sync.pending'), num(d.pending))}
                            {fact(t('system.sync.unresolved'), num(d.unresolved))}
                            {fact(t('system.sync.dead'), num(d.dead))}
                            {fact(t('system.sync.processed24h'), num(d.processedLast24h))}
                            {fact(t('system.sync.lastProcessed'), dateTime(d.lastProcessedAt) ?? none)}
                            {fact(t('system.sync.oldestOpen'), dateTime(d.oldestOpenAt) ?? t('system.none'))}
                        </dl>
                        {d.recentProblems.length > 0 && (
                            <ul className={styles.attentionList}>
                                {d.recentProblems.map((p, i) => (
                                    <li key={`${p.type}-${i}`} className={styles.jobRow}>
                                        <span className={tableStyles.cellTitle}>{p.type}</span>
                                        <span className={tableStyles.cellSub}>
                                            {t(`system.sync.eventStatus.${p.status as 'DEAD'}`)} · {t('system.sync.attempts', { count: p.attempts })} · {dateTime(p.at)}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                        <p className={tableStyles.cellSub}>{t('system.sync.note')}</p>
                    </>
                ), t('system.sync.okLabel'))}

                {card('signups', t('system.signups.title'), s.signups, (d) => (
                    <dl className={styles.factList}>
                        {fact(t('system.signups.failed'), num(d.failed))}
                        {fact(t('system.signups.stuck'), num(d.stuckProvisioning))}
                    </dl>
                ), t('system.signups.okLabel'))}

                {card('configuration', t('system.config.title'), s.configuration, (d) => (
                    <dl className={styles.factList}>
                        {fact(t('system.config.stripe'), d.stripeConfigured ? t('system.configured') : t('system.notConfigured'))}
                        {fact(t('system.config.stripeConnection'), t('home.unavailable'))}
                        {fact(t('system.config.email'), d.emailMode === 'smtp' ? t('system.config.emailSmtp') : t('system.config.emailConsole'))}
                        {fact(t('system.config.emailConnection'), t('home.unavailable'))}
                    </dl>
                ), t('system.config.okLabel'))}
            </div>
        </div>
    );
}
