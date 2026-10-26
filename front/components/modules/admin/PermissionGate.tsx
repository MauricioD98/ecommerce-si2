'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import styles from './admin-table.module.scss';
import { useAdminRole } from '@/hooks/useAdminAccess';
import { PermissionValue } from '@/utils/permissions';

// Muestra la vista solo si el usuario tiene el permiso; el backend igualmente lo vuelve a verificar
export default function PermissionGate({
    permission,
    children,
}: {
    permission: PermissionValue;
    children: React.ReactNode;
}) {
    const { can } = useAdminRole();
    const t = useTranslations('AdminShell');

    if (!can(permission)) {
        return (
            <div className={styles.page}>
                <div className={styles.errorMessage}>
                    {t('noPermission')} <Link href="/admin">{t('backToPanel')}</Link>
                </div>
            </div>
        );
    }

    return <>{children}</>;
}
