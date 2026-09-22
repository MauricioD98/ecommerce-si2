'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MapPin, Package, UserRound } from 'lucide-react';
import styles from './account.module.scss';
import { useAuth } from '@/hooks/useAuth';
import ProfileTab from './ProfileTab';
import AddressesTab from './AddressesTab';
import OrdersTab from './OrdersTab';
import ChangePasswordCard from './ChangePasswordCard';
import PushNotificationsCard from './PushNotificationsCard';

type TabId = 'profile' | 'addresses' | 'orders';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'profile', label: 'Mi perfil', icon: <UserRound size={18} /> },
    { id: 'orders', label: 'Mis pedidos', icon: <Package size={18} /> },
    { id: 'addresses', label: 'Mis direcciones', icon: <MapPin size={18} /> },
];

// "Mi cuenta": panel del cliente con menú lateral (pestañas arriba en móvil)
export default function AccountClient() {
    const { isAuthenticated, user } = useAuth();
    const router = useRouter();
    const searchParams = useSearchParams();
    const initialTab = (searchParams.get('tab') as TabId | null);
    const [tab, setTab] = useState<TabId>(initialTab && TABS.some((t) => t.id === initialTab) ? initialTab : 'profile');

    useEffect(() => {
        if (!isAuthenticated) {
            router.push('/auth/login?redirect=/account');
        }
    }, [isAuthenticated, router]);

    if (!isAuthenticated || !user) return null;

    const displayName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;

    return (
        <section className={styles.page}>
            <div className={styles.layout}>
                <aside className={styles.sidebar}>
                    <div className={styles.userBox}>
                        <span className={styles.avatar} aria-hidden="true">
                            {displayName.charAt(0).toUpperCase()}
                        </span>
                        <div className={styles.userInfo}>
                            <p className={styles.userName}>{displayName}</p>
                            <p className={styles.userEmail}>{user.email}</p>
                        </div>
                    </div>

                    <nav className={styles.tabs} role="tablist" aria-label="Secciones de mi cuenta">
                        {TABS.map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                role="tab"
                                aria-selected={tab === item.id}
                                className={`${styles.tab} ${tab === item.id ? styles.tabActive : ''}`}
                                onClick={() => setTab(item.id)}
                            >
                                {item.icon}
                                {item.label}
                            </button>
                        ))}
                    </nav>
                </aside>

                <div className={styles.content} role="tabpanel">
                    {tab === 'profile' && (
                        <div className={styles.stack}>
                            <ProfileTab />
                            <PushNotificationsCard />
                            <ChangePasswordCard />
                        </div>
                    )}
                    {tab === 'orders' && <OrdersTab />}
                    {tab === 'addresses' && <AddressesTab />}
                </div>
            </div>
        </section>
    );
}
