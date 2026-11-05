'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Lock, LogOut, Store } from 'lucide-react';
import { useTranslations } from 'next-intl';
import styles from './admin-layout.module.scss';
import tableStyles from './admin-table.module.scss';
import { getAdminLinks, getLockedModuleForPath } from './adminNav';
import { useAdminGuard } from '@/hooks/useAdminAccess';
import { useAuth } from '@/hooks/useAuth';
import LanguageSwitcher from '../i18n/LanguageSwitcher';
import { BASE_ROLE_KEYS } from '@/utils/permissions';
import { useStoreName, useStorePlan } from '@/providers/StoreInfoProvider';

// Layout protegido del panel: solo roles con algún permiso de gestión
export default function AdminShell({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();
    const { logout } = useAuth();
    const t = useTranslations('AdminShell');
    const tNav = useTranslations('AdminNav');
    const tRoles = useTranslations('AdminRoles');
    const storeName = useStoreName();
    const { features } = useStorePlan();
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

    const lockedModule = getLockedModuleForPath(pathname, features);
    const roleText =
        user?.role?.name && BASE_ROLE_KEYS[user.role.name]
            ? tRoles(`baseRoles.${BASE_ROLE_KEYS[user.role.name]}.name`)
            : user?.role?.name;

    return (
        <div className={styles.shell}>
            <aside className={styles.sidebar}>
                <Link href="/admin" className={styles.brand}>{storeName}</Link>
                <span className={styles.roleLabel}>
                    {roleText} · Plan {features.planName}
                </span>

                <nav className={styles.nav} aria-label={tNav('menuLabel')}>
                    {getAdminLinks(can, isGlobal, isSuperAdmin, features).map(({ href, label, icon: Icon, highlight }) => (
                        <Link
                            key={href}
                            href={href}
                            className={`${styles.navLink} ${highlight ? styles.navLinkHighlight : ''} ${pathname.startsWith(href) ? styles.navLinkActive : ''}`}
                        >
                            <Icon size={18} className={highlight ? styles.navIconHighlight : undefined} />
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

            <main className={styles.content}>
                {lockedModule ? (
                    <div className={tableStyles.page}>
                        <div className={tableStyles.tableCard} style={{ padding: '2rem', textAlign: 'center' }}>
                            <Lock size={32} style={{ margin: '0 auto 0.75rem', opacity: 0.7 }} />
                            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                                {tNav(lockedModule.label)} disponible desde el Plan {lockedModule.requiredPlan}
                            </h2>
                            <p style={{ color: 'var(--muted-foreground)', marginBottom: '1.25rem' }}>
                                Tu tienda está actualmente en el <strong>Plan {features.planName}</strong>. Mejora tu suscripción para habilitar este módulo.
                            </p>
                            {isSuperAdmin && (
                                <Link href="/admin/suscripcion" className={tableStyles.button}>
                                    Ver planes y suscripción
                                </Link>
                            )}
                        </div>
                    </div>
                ) : (
                    children
                )}
            </main>
        </div>
    );
}
