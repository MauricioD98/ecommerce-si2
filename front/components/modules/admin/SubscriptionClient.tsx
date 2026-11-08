'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, Check, CheckCircle2, CreditCard, Loader2, RefreshCw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import ui from './billing.module.scss';
import { BILLING_INTERVALS, PLANS, formatPlanPrice, type BillingInterval, type PlanKey } from '@/components/modules/platform/plans';
import { subscriptionService, type TenantSubscription } from '@/service/api/subscription.service';
import { getApiErrorMessage } from '@/service/api/error.utils';
import { intlLocale } from '@/i18n/config';
import { useStorePlan } from '@/providers/StoreInfoProvider';
import { usePlanPrices } from '@/hooks/usePlanPrices';

// Color de la pill por estado de Stripe; el texto es AdminSubscription.statuses.<estado>
const STATUS_PILL = {
    active: ui.pillGreen,
    trialing: ui.pillBlue,
    past_due: ui.pillAmber,
    incomplete: ui.pillAmber,
    unpaid: ui.pillRed,
    canceled: ui.pillRed,
    incomplete_expired: ui.pillRed,
    paused: ui.pill,
} as const;
type KnownStatus = keyof typeof STATUS_PILL;
const isKnownStatus = (status: string): status is KnownStatus => status in STATUS_PILL;

// Tras volver de Stripe el webhook puede tardar unos segundos: se reconsulta hasta verla activa
const POLL_INTERVAL_MS = 3000;
const POLL_ATTEMPTS = 10;

// Suscripción de la tienda al SaaS (solo Super Admin). Sin suscripción viva se contrata con Stripe
// Checkout (mensual o anual); con una viva, cambiar de plan o de intervalo va por el Billing Portal
// para no crear una segunda suscripción.
export default function SubscriptionClient() {
    const searchParams = useSearchParams();
    const checkoutResult = searchParams.get('checkout');
    const sessionId = searchParams.get('session_id');
    const t = useTranslations('AdminSubscription');
    const tPlans = useTranslations('Plans');
    const locale = useLocale();
    const { refreshStoreInfo } = useStorePlan();
    const { priceOf } = usePlanPrices();

    const [subscription, setSubscription] = useState<TenantSubscription | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isConfirming, setIsConfirming] = useState(checkoutResult === 'success');
    const [redirecting, setRedirecting] = useState<PlanKey | 'portal' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [billing, setBilling] = useState<BillingInterval>('monthly');
    const attempts = useRef(0);

    const load = useCallback(async () => {
        try {
            const data = await subscriptionService.get(sessionId);
            setSubscription(data);
            if (data.interval) setBilling(data.interval);
            setError(null);
            refreshStoreInfo();
            return data;
        } catch (err) {
            setError(getApiErrorMessage(err, t('loadFailed')));
            return null;
        } finally {
            setIsLoading(false);
        }
        // t solo cambia con el idioma: no hace falta recrear load por eso
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId, refreshStoreInfo]);

    useEffect(() => {
        // Carga inicial: los setState ocurren después del await dentro de load, no de forma síncrona
        // eslint-disable-next-line react-hooks/set-state-in-effect
        load();
    }, [load]);

    // ?checkout=success solo dice que el usuario volvió de Stripe, no que pagó: lo que vale es el
    // estado que el backend recibió por el webhook firmado (o verificó directo con session_id)
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
            const url =
                target === 'portal' ? await subscriptionService.openPortal() : await subscriptionService.createCheckout(target, billing);
            window.location.href = url;
        } catch (err) {
            setError(getApiErrorMessage(err, t('stripeFailed')));
            setRedirecting(null);
        }
    };

    const per = (interval: BillingInterval) => (interval === 'annual' ? t('perYear') : t('perMonth'));
    const periodEnd = subscription?.currentPeriodEnd
        ? new Date(subscription.currentPeriodEnd).toLocaleDateString(intlLocale(locale), { dateStyle: 'long' })
        : null;
    const statusLabel = subscription?.status
        ? isKnownStatus(subscription.status)
            ? t(`statuses.${subscription.status}`)
            : subscription.status
        : t('none');
    const statusClass = subscription?.status && isKnownStatus(subscription.status) ? STATUS_PILL[subscription.status] : ui.pillAmber;

    return (
        <div className={ui.page}>
            <header className={ui.header}>
                <div>
                    <h1>{t('title')}</h1>
                    <p>{t('subtitle')}</p>
                </div>
                {subscription?.canManage && (
                    <button type="button" className={`${ui.btn} ${ui.btnDark}`} onClick={() => redirectTo('portal')} disabled={redirecting !== null}>
                        {redirecting === 'portal' ? <Loader2 size={18} aria-hidden /> : <CreditCard size={18} aria-hidden />}
                        {redirecting === 'portal' ? t('opening') : t('manage')}
                    </button>
                )}
            </header>

            {error && (
                <div role="alert" className={`${ui.banner} ${ui.bannerError}`}>
                    <AlertCircle size={20} aria-hidden />
                    <span>{error}</span>
                </div>
            )}
            {checkoutResult === 'cancelled' && !subscription?.active && (
                <div role="status" className={`${ui.banner} ${ui.bannerInfo}`}>
                    <AlertCircle size={20} aria-hidden />
                    <span>{t('cancelled')}</span>
                </div>
            )}
            {isConfirming && (
                <div role="status" className={`${ui.banner} ${ui.bannerInfo}`}>
                    <Loader2 size={20} aria-hidden />
                    <span>{t('confirming')}</span>
                </div>
            )}
            {checkoutResult === 'success' && !isConfirming && subscription?.active && (
                <div role="status" className={`${ui.banner} ${ui.bannerOk}`}>
                    <CheckCircle2 size={20} aria-hidden />
                    <span>{t('activeNow')}</span>
                </div>
            )}
            {checkoutResult === 'success' && !isConfirming && subscription && !subscription.active && (
                <div role="status" className={`${ui.banner} ${ui.bannerWarn}`}>
                    <AlertCircle size={20} aria-hidden />
                    <span>{t('notConfirmed')}</span>
                </div>
            )}

            {isLoading ? (
                <div role="status" className={`${ui.banner} ${ui.bannerInfo}`}>
                    <RefreshCw size={20} aria-hidden />
                    <span>{t('loading')}</span>
                </div>
            ) : (
                subscription && (
                    <>
                        <section aria-label={t('currentPlan')} className={ui.current}>
                            <div className={ui.currentPlan}>
                                <div className={`${ui.tile} ${ui.tileDark}`}>
                                    <CreditCard size={24} aria-hidden />
                                </div>
                                <div>
                                    <div className={ui.eyebrow}>{t('currentPlan')}</div>
                                    <div className={ui.currentName}>{subscription.planName}</div>
                                </div>
                            </div>
                            <div className={ui.currentStatus}>
                                <span className={`${ui.pill} ${ui.pillLarge} ${statusClass}`}>
                                    <span className={ui.dot} aria-hidden />
                                    {statusLabel}
                                </span>
                                {subscription.active ? (
                                    <span>
                                        {subscription.interval && t(subscription.interval === 'annual' ? 'billedAnnually' : 'billedMonthly')}
                                        {subscription.amount != null &&
                                            subscription.interval &&
                                            ` · ${formatPlanPrice(subscription.amount, subscription.currency ?? 'USD')}${per(subscription.interval)}`}
                                        {periodEnd &&
                                            ` · ${subscription.cancelAtPeriodEnd ? t('endsOn') : t('renewsOn')} ${periodEnd}`}
                                    </span>
                                ) : (
                                    <span>{t('chooseHint')}</span>
                                )}
                            </div>
                        </section>

                        <div className={ui.toggle} role="radiogroup" aria-label={t('billingLabel')}>
                            {BILLING_INTERVALS.map((interval) => (
                                <button
                                    key={interval}
                                    type="button"
                                    role="radio"
                                    aria-checked={billing === interval}
                                    onClick={() => setBilling(interval)}
                                >
                                    {t(interval)}
                                    {interval === 'annual' && <span className={ui.toggleBadge}>{t('annualBadge')}</span>}
                                </button>
                            ))}
                        </div>

                        <section aria-label={t('plansLabel')} className={ui.plans}>
                            {PLANS.map((plan) => {
                                const price = priceOf(plan.key, billing);
                                const isCurrent = subscription.plan === plan.key;
                                const isCurrentPrice = subscription.active && isCurrent && subscription.interval === billing;
                                const featured = plan.highlighted && !isCurrent;
                                const busy = redirecting !== null;
                                return (
                                    <article key={plan.key} className={`${ui.plan} ${featured ? ui.planFeatured : ''}`}>
                                        <div className={ui.planHead}>
                                            <h2>{plan.name}</h2>
                                            {isCurrent ? (
                                                <span className={ui.pill}>{t('yourPlan')}</span>
                                            ) : (
                                                plan.highlighted && <span className={`${ui.pill} ${ui.pillDark}`}>{t('recommended')}</span>
                                            )}
                                        </div>
                                        <div className={ui.price}>
                                            <b>{formatPlanPrice(price.amount, price.currency)}</b>
                                            <span>{per(billing)}</span>
                                        </div>
                                        {billing === 'annual' && (
                                            <p className={ui.priceNote}>
                                                {t('annualEquivalent', { price: formatPlanPrice(price.amount / 12, price.currency) })}
                                            </p>
                                        )}
                                        <ul className={ui.features}>
                                            {(tPlans.raw(`${plan.key}.features`) as string[]).map((feature) => (
                                                <li key={feature}>
                                                    <Check size={20} aria-hidden />
                                                    {feature}
                                                </li>
                                            ))}
                                        </ul>
                                        <div className={ui.planAction}>
                                            {subscription.active ? (
                                                // Con suscripción viva el cambio va por el portal de Stripe
                                                <button
                                                    type="button"
                                                    className={`${ui.btn} ${ui.btnBlock} ${featured ? ui.btnDark : ui.btnLine}`}
                                                    onClick={() => redirectTo('portal')}
                                                    disabled={busy || isCurrentPrice || !subscription.canManage}
                                                >
                                                    {isCurrentPrice ? t('currentButton') : t('changeTo', { plan: plan.name })}
                                                </button>
                                            ) : (
                                                <button
                                                    type="button"
                                                    className={`${ui.btn} ${ui.btnBlock} ${featured ? ui.btnDark : ui.btnLine}`}
                                                    onClick={() => redirectTo(plan.key)}
                                                    disabled={busy || !price.available}
                                                >
                                                    {redirecting === plan.key && <Loader2 size={18} aria-hidden />}
                                                    {!price.available
                                                        ? t('unavailable')
                                                        : redirecting === plan.key
                                                          ? t('redirecting')
                                                          : t('choose', { plan: plan.name })}
                                                </button>
                                            )}
                                        </div>
                                    </article>
                                );
                            })}
                        </section>

                        {subscription.active && subscription.canManage && <p className={ui.hint}>{t('changeHint')}</p>}
                    </>
                )
            )}
        </div>
    );
}
