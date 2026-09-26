'use client';

import React, { useEffect, useState } from 'react';
import { CloudOff } from 'lucide-react';
import styles from './checkout.module.scss';

// Se muestra en vez de la confirmación de pago normal cuando el pedido se guardó offline
// (CheckoutClient -> handleSaveOfflineOrder). El envío real al backend lo hace
// useOfflineOrderSync (montado en OfflineSyncProvider) apenas vuelva la conexión.
export default function OfflineSuccessClient() {
    const [countdown, setCountdown] = useState<number>(4);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            if ('caches' in window) {
                caches.keys().then((keys) => {
                    keys.filter((k) => k.startsWith('sf-api')).forEach((k) => caches.delete(k));
                }).catch(() => undefined);
            }
            if (navigator.serviceWorker?.controller) {
                navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_API_CACHE' });
            }
            window.dispatchEvent(new CustomEvent('inventory-changed'));
        }

        const timer = setInterval(() => {
            setCountdown((prev) => {
                if (prev <= 1) {
                    clearInterval(timer);
                    window.location.href = '/';
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(timer);
    }, []);

    return (
        <section className={styles.section}>
            <div className={styles.container}>
                <div className={styles.stepContent}>
                    <div className={styles.success}>
                        <div className={styles.successIcon}>
                            <CloudOff size={56} strokeWidth={2.5} />
                        </div>
                        <h2>¡Pedido guardado en tu dispositivo!</h2>
                        <p className={styles.orderId}>
                            Se enviará automáticamente cuando recuperes la conexión a Internet. No hace falta que
                            hagas nada más: podés cerrar la app tranquilo.
                        </p>
                        <p style={{ marginTop: '0.75rem', marginBottom: '1.25rem', color: '#6b7280', fontSize: '0.95rem' }}>
                            Redirigiendo a la tienda en {countdown} segundos...
                        </p>
                        <button type="button" className={styles.continueButton} onClick={() => { window.location.href = '/'; }}>
                            Volver a la tienda
                        </button>
                    </div>
                </div>
            </div>
        </section>
    );
}
