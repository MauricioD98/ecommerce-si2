'use client'

import React from 'react';
import styles from './breadcrumbs.module.scss'
import { Link } from 'lucide-react';
import { useTranslations } from 'next-intl';

export default function Breadcrumbs({ productName }: { productName: string }) {
    const t = useTranslations('Product');

    return (
        <div className={styles.breadcrumbs}>
            <div className={styles.container}>
                <nav className={styles.nav} aria-label={t('breadcrumbLabel')}>
                    <Link className={styles.link} href="/">
                        {t('store')}
                    </Link>
                    <span className={styles.separator}></span>
                    <span className={styles.current}>{productName}</span>
                </nav>
            </div>
        </div>
    )
}