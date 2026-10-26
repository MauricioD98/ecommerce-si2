'use client';

import React from 'react';
import { BellRing, Check, Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import styles from './account.module.scss';
import { usePushNotifications } from '@/hooks/usePushNotifications';

// Activación de notificaciones push del navegador (estado de pedidos, novedades)
export default function PushNotificationsCard() {
    const { isSupported, permission, isSubscribed, isLoading, error, subscribe } = usePushNotifications();
    const t = useTranslations('Account.push');

    if (!isSupported) return null;

    return (
        <div className={styles.card}>
            <h2 className={styles.heading}>{t('title')}</h2>
            <p className={styles.subheading}>{t('subtitle')}</p>

            {error && (
                <div className={styles.alertError} role="alert">
                    <Info size={18} />
                    <span>{error}</span>
                </div>
            )}

            {isSubscribed ? (
                <div className={styles.alertSuccess} role="status">
                    <Check size={18} />
                    <span>{t('enabled')}</span>
                </div>
            ) : permission === 'denied' ? (
                <>
                    <span className={styles.hint}>
                        {t('blocked')}
                    </span>
                </>
            ) : (
                <button type="button" className={styles.secondaryButton} onClick={subscribe} disabled={isLoading}>
                    <BellRing size={18} />
                    {isLoading ? t('enabling') : t('enable')}
                </button>
            )}
        </div>
    );
}
