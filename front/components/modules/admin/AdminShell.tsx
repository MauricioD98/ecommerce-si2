'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, Store } from 'lucide-react';
import styles from './admin-layout.module.scss';
import { getAdminLinks } from './adminNav';
import { useAdminGuard } from '@/hooks/useAdminAccess';
import { useAuth } from '@/hooks/useAuth';

// Layout protegido del panel: solo roles con algún permiso de gestión
export default function AdminShell({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();
    const { logout } = useAuth();
    const { user, isAuthenticated, isGlobal, canAccess, can, branchId, profileReady } = useAdminGuard();

    useEffect(() => {
        if (!isAuthenticated) {
            router.replace('/auth/login?redirect=/admin');
        } else if (profileReady && !canAccess) {
            // Los roles sin permisos de gestión (Cliente, Empleado) no tienen panel
            router.replace('/');
        }
    }, [isAuthenticated, profileReady, canAccess, router]);

    if (!isAuthenticated || !profileReady || !canAccess) {
        return <div className={styles.fullscreenMessage}>Verificando acceso...</div>;
    }

    // Un admin de sucursal sin sucursal asignada no puede operar
    if (!isGlobal && !branchId) {
        return (
            <div className={styles.fullscreenMessage}>
                <p>Tu cuenta no tiene una sucursal asignada. Contacta a un superadministrador.</p>
                <Link href="/">Volver a la tienda</Link>
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
                <Link href="/admin" className={styles.brand}>STELLA FEMME</Link>
                <span className={styles.roleLabel}>{user?.role?.name}</span>

                <nav className={styles.nav} aria-label="Menú del panel">
                    {getAdminLinks(can, isGlobal).map(({ href, label, icon: Icon }) => (
                        <Link
                            key={href}
                            href={href}
                            className={`${styles.navLink} ${pathname.startsWith(href) ? styles.navLinkActive : ''}`}
                        >
                            <Icon size={18} />
                            {label}
                        </Link>
                    ))}
                </nav>

                <div className={styles.sidebarFooter}>
                    <span className={styles.userEmail}>{user?.email}</span>
                    <Link href="/" className={styles.footerButton}>
                        <Store size={18} />
                        Volver a la tienda
                    </Link>
                    <button type="button" className={styles.footerButton} onClick={handleLogout}>
                        <LogOut size={18} />
                        Cerrar sesión
                    </button>
                </div>
            </aside>

            <main className={styles.content}>{children}</main>
        </div>
    );
}
