'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CreditCard, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import styles from './admin-table.module.scss';
import { connectService, ConnectStatus } from '@/service/api/connect.service';
import { getApiErrorMessage } from '@/service/api/error.utils';

// Habilita el cobro con tarjeta de la tienda: cuenta de Stripe Connect (Express) donde caen sus
// ventas. Al volver del formulario de Stripe se vuelve a leer el estado (el backend consulta a
// Stripe, no depende solo del webhook).
export default function PaymentsSetupClient() {
    const t = useTranslations('AdminPayments');
    const searchParams = useSearchParams();
    const returnState = searchParams.get('connect');

    const [status, setStatus] = useState<ConnectStatus | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isRedirecting, setIsRedirecting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setIsLoading(true);
        try {
            setStatus(await connectService.getStatus());
            setError(null);
        } catch (err) {
            setError(getApiErrorMessage(err, t('loadFailed')));
        } finally {
            setIsLoading(false);
        }
        // t solo cambia con el idioma
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const startOnboarding = async () => {
        setIsRedirecting(true);
        setError(null);
        try {
            window.location.href = await connectService.startOnboarding();
        } catch (err) {
            setError(getApiErrorMessage(err, t('onboardingFailed')));
            setIsRedirecting(false);
        }
    };

    const state = !status ? null : status.chargesEnabled ? 'enabled' : status.connected ? 'pending' : 'none';
    const badge =
        state === 'enabled' ? styles.badgeSuccess : state === 'pending' ? styles.badgeWarning : styles.badgeMuted;

    return (
        <div className={styles.page}>
            <div className={styles.pageHeader}>
                <div>
                    <h1>{t('title')}</h1>
                    <p>{t('subtitle')}</p>
                </div>
                <button type="button" className={styles.buttonSecondary} onClick={load} disabled={isLoading}>
                    <RefreshCw size={16} />
                    {t('refresh')}
                </button>
            </div>

            {returnState === 'refresh' && <div className={styles.errorMessage}>{t('linkExpired')}</div>}
            {returnState === 'return' && state === 'enabled' && <div className={styles.successMessage}>{t('enabledNow')}</div>}
            {error && <div className={styles.errorMessage}>{error}</div>}

            {isLoading && !status ? (
                <div className={styles.loadingState}>{t('loading')}</div>
            ) : (
                state && (
                    <div className={styles.tableCard}>
                        <div className={`${styles.form} ${styles.formCard}`}>
                            <div className={styles.cellMain}>
                                <span className={styles.statLabel}>{t('statusLabel')}</span>
                                <span>
                                    <span className={`${styles.badge} ${badge}`}>{t(`states.${state}`)}</span>
                                </span>
                            </div>
                            <p className={styles.cellSub}>{t(`descriptions.${state}`)}</p>
                            {state === 'pending' && status && status.pendingRequirements > 0 && (
                                <p className={styles.cellSub}>{t('pendingRequirements', { count: status.pendingRequirements })}</p>
                            )}
                            {state !== 'enabled' && (
                                <div>
                                    <button type="button" className={styles.button} onClick={startOnboarding} disabled={isRedirecting}>
                                        <CreditCard size={16} />
                                        {isRedirecting ? t('redirecting') : state === 'pending' ? t('continue') : t('setup')}
                                    </button>
                                </div>
                            )}
                            <small className={styles.cellSub}>{t('note')}</small>
                        </div>
                    </div>
                )
            )}
        </div>
    );
}
