'use client';

import React from 'react';
import Link from 'next/link';
import styles from './admin-layout.module.scss';
import tableStyles from './admin-table.module.scss';
import { getAdminLinks } from './adminNav';
import { useAdminRole } from '@/hooks/useAdminAccess';

export default function AdminHome() {
    const { user, isGlobal, can } = useAdminRole();

    return (
        <div className={tableStyles.page}>
            <div className={tableStyles.pageHeader}>
                <div>
                    <h1>Panel administrativo</h1>
                    <p>
                        Hola{user?.firstName ? `, ${user.firstName}` : ''}.{' '}
                        {isGlobal
                            ? 'Gestiona todas las sucursales de STELLA FEMME.'
                            : 'Gestiona tu sucursal.'}
                    </p>
                </div>
            </div>

            <div className={styles.homeGrid}>
                {getAdminLinks(can, isGlobal).map(({ href, label, icon: Icon }) => (
                    <Link key={href} href={href} className={styles.homeCard}>
                        <Icon size={24} />
                        {label}
                    </Link>
                ))}
            </div>
        </div>
    );
}
