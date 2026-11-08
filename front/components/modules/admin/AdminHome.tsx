'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import styles from './home.module.scss';
import { getAdminLinks, type AdminNavLink } from './adminNav';
import { useAdminRole } from '@/hooks/useAdminAccess';
import { useStoreName, useStorePlan } from '@/providers/StoreInfoProvider';

// Grupos del inicio del panel, por ruta. Un módulo que el usuario no puede ver (permiso, rol o plan)
// no llega desde getAdminLinks, así que tampoco aparece acá; un grupo vacío no se muestra.
const GROUPS = [
    { key: 'sales', hrefs: ['/admin/pos', '/admin/returns', '/admin/orders'] },
    { key: 'catalog', hrefs: ['/admin/products', '/admin/categories', '/admin/collections', '/admin/inventory'] },
    { key: 'business', hrefs: ['/admin/branches', '/admin/staff', '/admin/roles', '/admin/reports', '/admin/notifications'] },
    { key: 'store', hrefs: ['/admin/suscripcion', '/admin/settings/payments', '/admin/settings/appearance'] },
] as const;

export default function AdminHome() {
    const { user, isGlobal, isSuperAdmin, can } = useAdminRole();
    const t = useTranslations('AdminShell');
    const tHome = useTranslations('AdminHome');
    const tNav = useTranslations('AdminNav');
    const storeName = useStoreName();
    const { features } = useStorePlan();

    const links = getAdminLinks(can, isGlobal, isSuperAdmin, features);
    const byHref = new Map(links.map((link) => [link.href, link]));
    const groups = GROUPS.map((group) => ({
        key: group.key,
        links: group.hrefs.map((href) => byHref.get(href)).filter((link): link is AdminNavLink => Boolean(link)),
    })).filter((group) => group.links.length > 0);

    return (
        <div className={styles.page}>
            <header className={styles.header}>
                <div>
                    <h1>{t('homeTitle')}</h1>
                    <p>
                        {user?.firstName ? t('greetingName', { name: user.firstName }) : t('greeting')}{' '}
                        {isGlobal ? t('manageAll', { store: storeName }) : t('manageOwn')}
                    </p>
                </div>
                <span className={styles.planPill}>Plan {features.planName}</span>
            </header>

            {groups.map((group) => (
                <section key={group.key} className={styles.group} aria-labelledby={`home-${group.key}`}>
                    <h2 id={`home-${group.key}`} className={styles.groupTitle}>
                        {tHome(`groups.${group.key}`)}
                    </h2>
                    <div className={`${styles.grid} ${group.links.length < 3 ? styles.gridSparse : ''}`}>
                        {group.links.map(({ href, label, icon: Icon }) => (
                            <Link key={href} href={href} className={styles.module}>
                                <span className={styles.tile}>
                                    <Icon size={22} aria-hidden />
                                </span>
                                <span>
                                    <span className={styles.moduleTitle}>{tNav(label)}</span>
                                    <span className={styles.moduleText}>{tHome(`descriptions.${label}`)}</span>
                                </span>
                            </Link>
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}
