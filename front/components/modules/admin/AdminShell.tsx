'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, Store } from 'lucide-react';
import { useTranslations } from 'next-intl';
import styles from './admin-layout.module.scss';
import { getAdminLinks } from './adminNav';
import { useAdminGuard } from '@/hooks/useAdminAccess';
import { useAuth } from '@/hooks/useAuth';
import LanguageSwitcher from '../i18n/LanguageSwitcher';
import { BASE_ROLE_KEYS } from '@/utils/permissions';
import { useStoreName } from '@/providers/StoreInfoProvider';

// Layout protegido del panel: solo roles con algún permiso de gestión
export default function AdminShell({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();
    const { logout } = useAuth();
    const t = useTranslations('AdminShell');
    const tNav = useTranslations('AdminNav');
    const tRoles = useTranslations('AdminRoles');
    const storeName = useStoreName();
    const { user, isAuthenticated, isGlobal, isSuperAdmin, canAccess, can, branchId, profileReady } = useAdminGuard();

    useEffect(() => {
        if (!isAuthenticated) {
            router.replace('/auth/login?redirect=/admin');
        } else if (profileReady && !canAccess) {
            // Los roles sin permisos de gestión (Cliente, Empleado) no tienen panel
            router.replace('/');
        }
    }, [isAuthenticated, profileReady, canAccess, router]);

    if (!isAuthenticated || !profileReady || !canAccess) {
        return <div className={styles.fullscreenMessage}>{t('checkingAccess')}</div>;
    }

    // Un admin de sucursal sin sucursal asignada no puede operar
    if (!isGlobal && !branchId) {
        return (
            <div className={styles.fullscreenMessage}>
                <p>{t('noBranch')}</p>
                <Link href="/">{t('backToStore')}</Link>
            </div>
        );
    }

    const handleLogout = async () => {
        await logout();
        router.push('/');
    };

    return (
        <div className={styles.shell}>
            <aside className={styles.sidebar}>
                <Link href="/admin" className={styles.brand}>{storeName}</Link>
                <span className={styles.roleLabel}>
                    {user?.role?.name && BASE_ROLE_KEYS[user.role.name] ? tRoles(`baseRoles.${BASE_ROLE_KEYS[user.role.name]}.name`) : user?.role?.name}
                </span>

                <nav className={styles.nav} aria-label={tNav('menuLabel')}>
                    {getAdminLinks(can, isGlobal, isSuperAdmin).map(({ href, label, icon: Icon }) => (
                        <Link
                            key={href}
                            href={href}
                            className={`${styles.navLink} ${pathname.startsWith(href) ? styles.navLinkActive : ''}`}
                        >
                            <Icon size={18} />
                            {tNav(label)}
                        </Link>
                    ))}
                </nav>

                <div className={styles.sidebarFooter}>
                    <span className={styles.userEmail}>{user?.email}</span>
                    <LanguageSwitcher className={styles.languageSwitcher} />
                    <Link href="/" className={styles.footerButton}>
                        <Store size={18} />
                        {t('backToStore')}
                    </Link>
                    <button type="button" className={styles.footerButton} onClick={handleLogout}>
                        <LogOut size={18} />
                        {t('logout')}
                    </button>
                </div>
            </aside>

            <main className={styles.content}>{children}</main>
        </div>
    );
}
