'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { CloudOff } from 'lucide-react';
import styles from './checkout.module.scss';

// Se muestra en vez de la confirmación de pago normal cuando el pedido se guardó offline
// (CheckoutClient -> handleSaveOfflineOrder). El envío real al backend lo hace
// useOfflineOrderSync (montado en OfflineSyncProvider) apenas vuelva la conexión.
export default function OfflineSuccessClient() {
    const router = useRouter();

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
                        <button type="button" className={styles.continueButton} onClick={() => router.push('/')}>
                            Volver a la tienda
                        </button>
                    </div>
                </div>
            </div>
        </section>
    );
}
