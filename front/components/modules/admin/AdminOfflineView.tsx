'use client';

import React from 'react';
import { CloudOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import AdminShell from './AdminShell';
import PermissionGate from './PermissionGate';
import ProductsClient from './ProductsClient';
import CategoriesClient from './CategoriesClient';
import CollectionsClient from './CollectionsClient';
import OrdersClient from './OrdersClient';
import InventoryClient from './InventoryClient';
import styles from './admin-offline.module.scss';
import tableStyles from './admin-table.module.scss';
import { Permission } from '@/utils/permissions';

// Secciones del panel que funcionan sin conexión (con la copia guardada en IndexedDB y la cola de cambios)
const SECTIONS = [
    { path: '/admin/products', permission: Permission.MANAGE_PRODUCTS, label: 'products', render: () => <ProductsClient /> },
    { path: '/admin/categories', permission: Permission.MANAGE_PRODUCTS, label: 'categories', render: () => <CategoriesClient /> },
    { path: '/admin/collections', permission: Permission.MANAGE_PRODUCTS, label: 'collections', render: () => <CollectionsClient /> },
    { path: '/admin/orders', permission: Permission.VIEW_ORDERS, label: 'orders', render: () => <OrdersClient /> },
    { path: '/admin/inventory', permission: Permission.MANAGE_INVENTORY, label: 'inventory', render: () => <InventoryClient /> },
] as const;

/**
 * El panel abierto sin conexión desde el fallback /offline del service worker (el panel nunca se guarda en
 * Cache Storage). Solo se monta con una sesión renovable de un usuario con acceso al panel (OfflineAccountGate).
 */
export default function AdminOfflineView({ path }: { path: string }) {
    const t = useTranslations('AdminOffline');
    const tNav = useTranslations('AdminNav');
    const section = SECTIONS.find((s) => path === s.path || path.startsWith(`${s.path}/`));

    return (
        <div data-testid="offline-admin">
            <AdminShell>
                {section ? (
                    <PermissionGate permission={section.permission}>{section.render()}</PermissionGate>
                ) : (
                    <div className={tableStyles.page}>
                        <div className={styles.offlineCard}>
                            <h2>
                                <CloudOff size={18} aria-hidden="true" /> {path === '/admin' || path === '/admin/' ? t('homeTitle') : t('sectionRequiresConnection')}
                            </h2>
                            <p>{t('homeDescription')}</p>
                            <ul>
                                {SECTIONS.map((s) => (
                                    <li key={s.path}>
                                        {/* <a> real: navegación completa que el service worker resuelve sin red */}
                                        <a href={s.path}>{tNav(s.label)}</a>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                )}
            </AdminShell>
        </div>
    );
}
