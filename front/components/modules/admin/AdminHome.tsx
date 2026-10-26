'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import styles from './admin-layout.module.scss';
import tableStyles from './admin-table.module.scss';
import { getAdminLinks } from './adminNav';
import { useAdminRole } from '@/hooks/useAdminAccess';
import { useStoreName } from '@/providers/StoreInfoProvider';

export default function AdminHome() {
    const { user, isGlobal, isSuperAdmin, can } = useAdminRole();
    const t = useTranslations('AdminShell');
    const storeName = useStoreName();
    const tNav = useTranslations('AdminNav');

    return (
        <div className={tableStyles.page}>
            <div className={tableStyles.pageHeader}>
                <div>
                    <h1>{t('homeTitle')}</h1>
                    <p>
                        {user?.firstName ? t('greetingName', { name: user.firstName }) : t('greeting')}{' '}
                        {isGlobal ? t('manageAll', { store: storeName }) : t('manageOwn')}
                    </p>
                </div>
            </div>

            <div className={styles.homeGrid}>
                {getAdminLinks(can, isGlobal, isSuperAdmin).map(({ href, label, icon: Icon }) => (
                    <Link key={href} href={href} className={styles.homeCard}>
                        <Icon size={24} />
                        {tNav(label)}
                    </Link>
                ))}
            </div>
        </div>
    );
}
