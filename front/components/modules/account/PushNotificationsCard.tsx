'use client';

import React from 'react';
import { BellRing, Check, Info } from 'lucide-react';
import styles from './account.module.scss';
import { usePushNotifications } from '@/hooks/usePushNotifications';

// Activación de notificaciones push del navegador (estado de pedidos, novedades)
export default function PushNotificationsCard() {
    const { isSupported, permission, isSubscribed, isLoading, error, subscribe } = usePushNotifications();

    if (!isSupported) return null;

    return (
        <div className={styles.card}>
            <h2 className={styles.heading}>Notificaciones push</h2>
            <p className={styles.subheading}>Recibe un aviso en este navegador cuando cambie el estado de tus pedidos.</p>

            {error && (
                <div className={styles.alertError} role="alert">
                    <Info size={18} />
                    <span>{error}</span>
                </div>
            )}

            {isSubscribed ? (
                <div className={styles.alertSuccess} role="status">
                    <Check size={18} />
                    <span>Las notificaciones push están activadas en este dispositivo.</span>
                </div>
            ) : permission === 'denied' ? (
                <>
                    <span className={styles.hint}>
                        Bloqueaste las notificaciones para este sitio. Habilítalas desde los ajustes del navegador para activarlas.
                    </span>
                </>
            ) : (
                <button type="button" className={styles.secondaryButton} onClick={subscribe} disabled={isLoading}>
                    <BellRing size={18} />
                    {isLoading ? 'Activando...' : 'Activar notificaciones push'}
                </button>
            )}
        </div>
    );
}
