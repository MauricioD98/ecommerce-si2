'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import styles from './admin-table.module.scss';
import { useAdminRole } from '@/hooks/useAdminAccess';

// Como PermissionGate, pero solo para el rol "Super Admin" (dueño); el backend lo vuelve a verificar
export default function SuperAdminGate({ children }: { children: React.ReactNode }) {
    const { isSuperAdmin } = useAdminRole();
    const t = useTranslations('AdminShell');

    if (!isSuperAdmin) {
        return (
            <div className={styles.page}>
                <div className={styles.errorMessage}>
                    {t('ownerOnly')} <Link href="/admin">{t('backToPanel')}</Link>
                </div>
            </div>
        );
    }

    return <>{children}</>;
}
