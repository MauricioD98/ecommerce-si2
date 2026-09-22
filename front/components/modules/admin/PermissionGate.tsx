'use client';

import React from 'react';
import Link from 'next/link';
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

    if (!can(permission)) {
        return (
            <div className={styles.page}>
                <div className={styles.errorMessage}>
                    No tienes permiso para ver esta sección. <Link href="/admin">Volver al panel</Link>
                </div>
            </div>
        );
    }

    return <>{children}</>;
}
