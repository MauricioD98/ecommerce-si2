'use client';

import React, { useEffect, useState } from 'react';
import { CloudOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import styles from './checkout.module.scss';

// Se muestra en vez de la confirmación de pago normal cuando el pedido se guardó offline
// (CheckoutClient -> handleSaveOfflineOrder). El envío real al backend lo hace
// useOfflineOrderSync (montado en OfflineSyncProvider) apenas vuelva la conexión.
export default function OfflineSuccessClient() {
    const router = useRouter();
    const t = useTranslations('Checkout');
    const [countdown, setCountdown] = useState<number>(4);

    useEffect(() => {
        const timer = setInterval(() => {
            setCountdown((prev) => {
                if (prev <= 1) {
                    clearInterval(timer);
                    router.push('/');
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(timer);
    }, [router]);

    return (
        <section className={styles.section}>
            <div className={styles.container}>
                <div className={styles.stepContent}>
                    <div className={styles.success}>
                        <div className={styles.successIcon}>
                            <CloudOff size={56} strokeWidth={2.5} />
                        </div>
                        <h2>{t('offlineSuccess.title')}</h2>
                        <p className={styles.orderId}>
                            {t('offlineSuccess.description')}
                        </p>
                        <p style={{ marginTop: '0.75rem', marginBottom: '1.25rem', color: '#6b7280', fontSize: '0.95rem' }}>
                            {t('success.redirecting', { seconds: countdown })}
                        </p>
                        <button type="button" className={styles.continueButton} onClick={() => router.push('/')}>
                            {t('success.backToStore')}
                        </button>
                    </div>
                </div>
            </div>
        </section>
    );
}
