'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useStoreName } from '@/providers/StoreInfoProvider';
import styles from './footer.module.scss';

export default function Footer() {
    const t = useTranslations('Footer');
    const storeName = useStoreName();

    return (
        <footer className={styles.footer}>
            <div className={styles.container}>
                <div className={styles.content}>
                    <div className={styles.brand}>
                        <h3>{storeName}</h3>
                        <p>{t('tagline')}</p>
                    </div>

                    <div className={styles.section}>
                        <h4>{t('branches')}</h4>
                        <ul>
                            <li>
                                <Link href="/">{t('branchCentro')}</Link>
                            </li>
                            <li>
                                <Link href="/">{t('branchEquipetrol')}</Link>
                            </li>
                            <li>
                                <Link href="/">{t('onlineStore')}</Link>
                            </li>
                        </ul>
                    </div>

                    <div className={styles.section}>
                        <h4>{t('support')}</h4>
                        <ul>
                            <li>
                                <Link href="/">{t('faq')}</Link>
                            </li>
                            <li>
                                <Link href="/">{t('sizeGuide')}</Link>
                            </li>
                            <li>
                                <Link href="/">{t('shipping')}</Link>
                            </li>
                            <li>
                                <Link href="/">{t('returns')}</Link>
                            </li>
                        </ul>
                    </div>
                </div>

                <p className={styles.copyright}>
                    {t('rights', { year: new Date().getFullYear(), store: storeName })}
                </p>
            </div>
        </footer>
    );
}
