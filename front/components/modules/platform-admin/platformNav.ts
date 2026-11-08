import { Building2, CreditCard, DatabaseBackup, Gauge, LayoutDashboard, Store, UsersRound, type LucideIcon } from 'lucide-react';

// Menú del panel del SaaS. `ready: false` = la sección todavía no está implementada: el menú la marca
// como "Pendiente" y su página lo dice, sin mostrar datos de ejemplo.
export type PlatformSectionKey = 'home' | 'stores' | 'branches' | 'plans' | 'backups' | 'admins' | 'system';

export interface PlatformNavItem {
    key: PlatformSectionKey;
    href: string;
    icon: LucideIcon;
    ready: boolean;
}

export const PLATFORM_BASE_PATH = '/plataforma';

export const PLATFORM_NAV: PlatformNavItem[] = [
    { key: 'home', href: PLATFORM_BASE_PATH, icon: LayoutDashboard, ready: true },
    { key: 'stores', href: `${PLATFORM_BASE_PATH}/tiendas`, icon: Store, ready: true },
    { key: 'branches', href: `${PLATFORM_BASE_PATH}/sucursales`, icon: Building2, ready: true },
    { key: 'plans', href: `${PLATFORM_BASE_PATH}/planes`, icon: CreditCard, ready: true },
    { key: 'backups', href: `${PLATFORM_BASE_PATH}/respaldos`, icon: DatabaseBackup, ready: true },
    { key: 'admins', href: `${PLATFORM_BASE_PATH}/administradores`, icon: UsersRound, ready: true },
    { key: 'system', href: `${PLATFORM_BASE_PATH}/sistema`, icon: Gauge, ready: true },
];

/** Sección activa: coincidencia exacta para Inicio, por prefijo para el resto. */
export function isNavItemActive(item: PlatformNavItem, pathname: string | null): boolean {
    if (!pathname) return false;
    const path = pathname.replace(/\/+$/, '') || '/';
    if (item.href === PLATFORM_BASE_PATH) return path === PLATFORM_BASE_PATH;
    return path === item.href || path.startsWith(`${item.href}/`);
}
