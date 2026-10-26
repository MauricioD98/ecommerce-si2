'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CreditCard } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import styles from './admin-table.module.scss';
import { PLANS, type PlanKey } from '@/components/modules/platform/plans';
import { subscriptionService, type TenantSubscription } from '@/service/api/subscription.service';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { intlLocale } from '@/i18n/config';

// Color del badge por estado de Stripe; el texto es AdminSubscription.statuses.<estado>
const STATUS_CLASSES = {
    active: styles.badgeSuccess,
    trialing: styles.badgeInfo,
    past_due: styles.badgeWarning,
    incomplete: styles.badgeWarning,
    unpaid: styles.badgeDanger,
    canceled: styles.badgeDanger,
    incomplete_expired: styles.badgeDanger,
    paused: styles.badgeMuted,
} as const;
type KnownStatus = keyof typeof STATUS_CLASSES;
const isKnownStatus = (status: string): status is KnownStatus => status in STATUS_CLASSES;

// Tras volver de Stripe el webhook puede tardar unos segundos: se reconsulta hasta verla activa
const POLL_INTERVAL_MS = 3000;
const POLL_ATTEMPTS = 10;

export default function SubscriptionClient() {
    const searchParams = useSearchParams();
    const checkoutResult = searchParams.get('checkout');
    const t = useTranslations('AdminSubscription');
    const locale = useLocale();

    const [subscription, setSubscription] = useState<TenantSubscription | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isConfirming, setIsConfirming] = useState(checkoutResult === 'success');
    const [redirecting, setRedirecting] = useState<PlanKey | 'portal' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const attempts = useRef(0);

    const load = useCallback(async () => {
        try {
            const data = await subscriptionService.get();
            setSubscription(data);
            setError(null);
            return data;
        } catch (err) {
            setError(getApiErrorMessage(err, t('loadFailed')));
            return null;
        } finally {
            setIsLoading(false);
        }
        // t solo cambia con el idioma: no hace falta recrear load por eso
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    // ?checkout=success solo dice que el usuario volvió de Stripe, no que pagó: lo que vale es el
    // estado que el backend recibió por el webhook firmado
    useEffect(() => {
        if (!isConfirming) return;
        if (subscription?.active || attempts.current >= POLL_ATTEMPTS) {
            setIsConfirming(false);
            return;
        }
        const timer = setTimeout(() => {
            attempts.current += 1;
            load();
        }, POLL_INTERVAL_MS);
        return () => clearTimeout(timer);
    }, [isConfirming, subscription, load]);

    const redirectTo = async (target: PlanKey | 'portal') => {
        setRedirecting(target);
        setError(null);
        try {
            const url = target === 'portal' ? await subscriptionService.openPortal() : await subscriptionService.createCheckout(target);
            window.location.href = url;
        } catch (err) {
            setError(getApiErrorMessage(err, t('stripeFailed')));
            setRedirecting(null);
        }
    };

    const status = subscription?.status
        ? isKnownStatus(subscription.status)
            ? { label: t(`statuses.${subscription.status}`), className: STATUS_CLASSES[subscription.status] }
            : { label: subscription.status, className: styles.badgeMuted }
        : null;
    const periodEnd = subscription?.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString(intlLocale(locale)) : null;

    return (
        <div className={styles.page}>
            <div className={styles.pageHeader}>
                <div>
                    <h1>{t('title')}</h1>
                    <p>{t('subtitle')}</p>
                </div>
                {subscription?.canManage && (
                    <button type="button" className={styles.button} onClick={() => redirectTo('portal')} disabled={redirecting !== null}>
                        <CreditCard size={16} />
                        {redirecting === 'portal' ? t('opening') : t('manage')}
                    </button>
                )}
            </div>

            {error && <div className={styles.errorMessage}>{error}</div>}
            {checkoutResult === 'cancelled' && !subscription?.active && (
                <div className={styles.errorMessage}>{t('cancelled')}</div>
            )}
            {isConfirming && <div className={styles.loadingState}>{t('confirming')}</div>}
            {checkoutResult === 'success' && !isConfirming && subscription?.active && (
                <div className={styles.successMessage}>{t('activeNow')}</div>
            )}
            {checkoutResult === 'success' && !isConfirming && subscription && !subscription.active && (
                <div className={styles.errorMessage}>{t('notConfirmed')}</div>
            )}

            {isLoading ? (
                <div className={styles.loadingState}>{t('loading')}</div>
            ) : (
                subscription && (
                    <>
                        <div className={styles.statGrid}>
                            <div className={styles.statCard}>
                                <span className={styles.statLabel}>{t('plan')}</span>
                                <span className={styles.statValue}>{subscription.planName}</span>
                            </div>
                            <div className={styles.statCard}>
                                <span className={styles.statLabel}>{t('status')}</span>
                                <span className={styles.statValue}>
                                    {status ? <span className={`${styles.badge} ${status.className}`}>{status.label}</span> : t('none')}
                                </span>
                            </div>
                            {periodEnd && (
                                <div className={styles.statCard}>
                                    <span className={styles.statLabel}>{subscription.cancelAtPeriodEnd ? t('endsOn') : t('renewsOn')}</span>
                                    <span className={styles.statValue}>{periodEnd}</span>
                                    {subscription.cancelAtPeriodEnd && <span className={styles.cellSub}>{t('noRenew')}</span>}
                                </div>
                            )}
                        </div>

                        {/* Con una suscripción viva, cambiar de plan va por el portal (no se crea otra) */}
                        {!subscription.active && (
                            <div className={styles.statGrid}>
                                {PLANS.map((plan) => (
                                    <div key={plan.key} className={styles.statCard}>
                                        <span className={styles.statLabel}>{plan.name}</span>
                                        <span className={styles.statValue}>
                                            {plan.price}
                                            <span className={styles.cellSub}>{t('perMonth')}</span>
                                        </span>
                                        <button
                                            type="button"
                                            className={plan.highlighted ? styles.button : styles.buttonSecondary}
                                            onClick={() => redirectTo(plan.key)}
                                            disabled={redirecting !== null}
                                        >
                                            {redirecting === plan.key ? t('redirecting') : t('choose', { plan: plan.name })}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )
            )}
        </div>
    );
}
