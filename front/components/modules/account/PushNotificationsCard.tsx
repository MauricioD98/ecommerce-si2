'use client';

import React from 'react';
import { BellOff, BellRing, Check, Info, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import styles from './account.module.scss';
import { usePushNotifications } from '@/hooks/usePushNotifications';

// Activación de notificaciones push del navegador (estado de pedidos, novedades) para la tienda actual.
// Cada restricción legítima (plan, HTTPS, iPhone sin instalar, permiso bloqueado) se explica en vez de
// mostrar un aviso genérico, y "activada" no se presenta como prueba de entrega: para eso está la prueba.
export default function PushNotificationsCard() {
    const {
        ready,
        environmentIssue,
        unavailableReason,
        permission,
        isSubscribed,
        isLoading,
        error,
        testOutcome,
        subscribe,
        unsubscribe,
        sendTest,
    } = usePushNotifications();
    const t = useTranslations('Account.push');

    if (!ready) return null;

    const notice = environmentIssue
        ? t(`environment.${environmentIssue}`)
        : unavailableReason
          ? t(`unavailable.${unavailableReason}`)
          : null;

    return (
        <div className={styles.card}>
            <h2 className={styles.heading}>{t('title')}</h2>
            <p className={styles.subheading}>{t('subtitle')}</p>

            {notice ? (
                <div className={styles.alertInfo} role="status">
                    <Info size={18} />
                    <span>{notice}</span>
                </div>
            ) : (
                <>
                    {error && (
                        <div className={styles.alertError} role="alert">
                            <Info size={18} />
                            <span>{error.code === 'SERVER' && error.message ? error.message : t(`errors.${error.code}`)}</span>
                        </div>
                    )}

                    {testOutcome && (
                        <div className={testOutcome.status === 'accepted' ? styles.alertInfo : styles.alertError} role="status">
                            <Info size={18} />
                            <span>{testOutcome.status === 'accepted' ? t('test.accepted') : t(`test.failed.${testOutcome.reason}`)}</span>
                        </div>
                    )}

                    {permission === 'denied' ? (
                        <span className={styles.hint}>{t('blocked')}</span>
                    ) : isSubscribed ? (
                        <>
                            <div className={styles.alertSuccess} role="status">
                                <Check size={18} />
                                <span>{t('enabled')}</span>
                            </div>
                            <div className={styles.buttonRow}>
                                <button
                                    type="button"
                                    className={styles.secondaryButton}
                                    onClick={() => sendTest({ title: t('test.title'), body: t('test.body') })}
                                    disabled={isLoading}
                                >
                                    <Send size={18} />
                                    {t('test.send')}
                                </button>
                                <button type="button" className={styles.secondaryButton} onClick={unsubscribe} disabled={isLoading}>
                                    <BellOff size={18} />
                                    {t('disable')}
                                </button>
                            </div>
                        </>
                    ) : (
                        <button type="button" className={styles.secondaryButton} onClick={subscribe} disabled={isLoading}>
                            <BellRing size={18} />
                            {isLoading ? t('enabling') : t('enable')}
                        </button>
                    )}
                </>
            )}
        </div>
    );
}
