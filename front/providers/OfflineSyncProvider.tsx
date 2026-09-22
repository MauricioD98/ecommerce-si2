'use client';

import React from 'react';
import { WifiOff, RefreshCw, AlertTriangle } from 'lucide-react';
import { useOfflineOrderSync } from '@/hooks/useOfflineOrderSync';
import { useRegisterServiceWorker } from '@/hooks/useRegisterServiceWorker';
import styles from './offline-sync.module.scss';

// Montado una sola vez en el árbol raíz: registra el service worker para todas las visitas (no solo
// quien activa push), dispara la sincronización de pedidos offline apenas vuelve la conexión (o al
// cargar la app, por si se cerró con pedidos pendientes) y muestra un aviso mínimo mientras haya
// pedidos en cola o si el último intento falló (ej. sin stock).
export default function OfflineSyncProvider({ children }: { children: React.ReactNode }) {
    useRegisterServiceWorker();
    const { pendingCount, isSyncing, lastSyncError, syncNow } = useOfflineOrderSync();

    return (
        <>
            {children}
            {(pendingCount > 0 || lastSyncError) && (
                <div className={styles.banner} role="status">
                    {lastSyncError ? (
                        <AlertTriangle size={16} />
                    ) : isSyncing ? (
                        <RefreshCw size={16} className={styles.spin} />
                    ) : (
                        <WifiOff size={16} />
                    )}
                    <span>
                        {lastSyncError
                            ? lastSyncError
                            : isSyncing
                                ? 'Enviando pedidos guardados...'
                                : `${pendingCount} pedido${pendingCount === 1 ? '' : 's'} guardado${pendingCount === 1 ? '' : 's'} en este dispositivo, pendiente${pendingCount === 1 ? '' : 's'} de enviar.`}
                    </span>
                    {!isSyncing && (
                        <button type="button" onClick={() => syncNow()}>
                            Reintentar
                        </button>
                    )}
                </div>
            )}
        </>
    );
}
