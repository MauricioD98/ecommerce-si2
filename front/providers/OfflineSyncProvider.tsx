'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { WifiOff, RefreshCw, FileClock, Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSelector } from 'react-redux';
import type { IRootState } from '@/store';
import { useCheckoutRecovery } from '@/hooks/useCheckoutRecovery';
import { useOfflineInventorySync } from '@/hooks/useOfflineInventorySync';
import { useProfileSyncRunner } from '@/hooks/useProfileSync';
import { useAdminSyncRunner } from '@/hooks/useAdminOffline';
import { SW_UPDATE_EVENT, applyServiceWorkerUpdate, useRegisterServiceWorker } from '@/hooks/useRegisterServiceWorker';
import { getOrderDrafts } from '@/utils/offlineOrderQueue';
import styles from './offline-sync.module.scss';

// Montado una sola vez en el árbol raíz: registra el service worker, recupera las compras con resultado
// incierto de la cuenta actual y sincroniza los ajustes de inventario. Los avisos distinguen lo que ya se
// envió ("verificando") de los borradores, que nunca se envían solos y requieren revisión.
export default function OfflineSyncProvider({ children }: { children: React.ReactNode }) {
    useRegisterServiceWorker();
    useOfflineInventorySync();
    // Cambios de perfil hechos sin conexión: se envían solos al volver la red (los borradores de compra no)
    useProfileSyncRunner();
    // Cambios del panel hechos sin conexión (solo para usuarios con acceso al panel)
    useAdminSyncRunner();
    const { inDoubt, recoverNow } = useCheckoutRecovery();
    const t = useTranslations('Offline');
    const userId = useSelector((state: IRootState) => state.auth.user?.id ?? null);
    const [draftCount, setDraftCount] = useState(0);
    const [updateReady, setUpdateReady] = useState(false);

    const refreshDrafts = useCallback(async () => {
        setDraftCount((await getOrderDrafts(userId).catch(() => [])).length);
    }, [userId]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        refreshDrafts();
        const onUpdate = () => setUpdateReady(true);
        window.addEventListener('offline-order-added', refreshDrafts);
        window.addEventListener('online', refreshDrafts);
        window.addEventListener(SW_UPDATE_EVENT, onUpdate);
        return () => {
            window.removeEventListener('offline-order-added', refreshDrafts);
            window.removeEventListener('online', refreshDrafts);
            window.removeEventListener(SW_UPDATE_EVENT, onUpdate);
        };
    }, [refreshDrafts]);

    return (
        <>
            {children}
            {inDoubt.length > 0 && (
                <div className={styles.banner} role="status">
                    <RefreshCw size={16} className={styles.spin} />
                    <span>{t('verifying')}</span>
                    <button type="button" onClick={() => recoverNow()}>
                        {t('retry')}
                    </button>
                </div>
            )}
            {inDoubt.length === 0 && draftCount > 0 && (
                <div className={styles.banner} role="status">
                    <FileClock size={16} />
                    <span>{t('pendingDrafts', { count: draftCount })}</span>
                    {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                    <a href="/checkout/drafts">{t('reviewDrafts')}</a>
                </div>
            )}
            {inDoubt.length === 0 && draftCount === 0 && updateReady && (
                <div className={styles.banner} role="status">
                    <Download size={16} />
                    <span>{t('updateAvailable')}</span>
                    {/* Nunca se recarga solo: una página en medio de un pago no se interrumpe */}
                    <button type="button" onClick={() => applyServiceWorkerUpdate()}>
                        {t('updateNow')}
                    </button>
                </div>
            )}
            <noscript>
                <WifiOff size={16} />
            </noscript>
        </>
    );
}
