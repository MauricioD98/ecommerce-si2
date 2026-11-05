'use client';

import React from 'react';
import { CloudOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import styles from './checkout.module.scss';

// Se muestra cuando la compra se guardó como BORRADOR sin conexión. No es una orden: no reserva stock ni
// tiene pago. Al volver la conexión se revisa y se confirma en /checkout/drafts.
export default function OfflineSuccessClient() {
    const t = useTranslations('Checkout');

    return (
        <section className={styles.section}>
            <div className={styles.container}>
                <div className={styles.stepContent}>
                    <div className={styles.success}>
                        <div className={styles.successIcon}>
                            <CloudOff size={56} strokeWidth={2.5} />
                        </div>
                        <h2>{t('offlineSuccess.title')}</h2>
                        <p className={styles.orderId}>{t('offlineSuccess.description')}</p>
                        {/* <a> real: sin red el router haría un fetch de datos que nunca llega */}
                        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                        <a className={styles.continueButton} href="/checkout/drafts">
                            {t('offlineSuccess.review')}
                        </a>
                    </div>
                </div>
            </div>
        </section>
    );
}
