'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { CloudOff } from 'lucide-react';
import { useSelector } from 'react-redux';
import { useTranslations } from 'next-intl';
import type { IRootState } from '@/store';
import { canUseOfflineSession } from '@/utils/offlineProfile';
import Header from '../landing/Header';
import AccountClient from './AccountClient';
import OrderDetailClient from './OrderDetailClient';
import AdminOfflineView from '../admin/AdminOfflineView';
import { canAccessAdmin } from '@/utils/permissions';
import styles from './account.module.scss';

const ORDER_PATH = /^\/account\/orders\/([^/]+)\/?$/;

type View = { kind: 'generic' } | { kind: 'account' } | { kind: 'order'; orderId: string } | { kind: 'admin'; path: string };

/**
 * El service worker sirve /offline cuando una página privada no se puede cargar sin red: "Mi cuenta", "Mis
 * pedidos" y el panel de administración nunca se guardan en Cache Storage. El panel se arma aquí si el usuario
 * tiene acceso a él (AdminOfflineView). Si lo pedido era la cuenta (/account) o un pedido
 * (/account/orders/<id>) y la sesión todavía es renovable y es del mismo usuario, aquí se arma esa pantalla con
 * las copias de IndexedDB. En cualquier otro caso (sin sesión, otra cuenta, sesión vencida) queda el aviso genérico.
 *
 * Arranca SIEMPRE con el aviso genérico: es lo que se renderizó en el servidor, sin datos de nadie.
 */
export default function OfflineAccountGate({ children }: { children: React.ReactNode }) {
    const auth = useSelector((state: IRootState) => state.auth);
    const [view, setView] = useState<View>({ kind: 'generic' });
    const t = useTranslations('Account.profile.sync');

    const userId = auth.user?.id ?? null;
    const sessionOk = canUseOfflineSession(auth);

    useEffect(() => {
        const path = window.location.pathname;
        // Panel de administración: misma regla de sesión, y además el usuario tiene que tener acceso al panel
        if (path.startsWith('/admin') && sessionOk && userId && canAccessAdmin(auth.user)) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setView({ kind: 'admin', path });
            return;
        }
        if (!path.startsWith('/account') || !sessionOk || !userId) {
            setView({ kind: 'generic' });
            return;
        }
        // Con la sesión vigente del mismo usuario basta: el perfil sale de la copia en IndexedDB o, si todavía no
        // hay copia, de los datos de la sesión guardada en este dispositivo (los mismos que ya muestra la cabecera)
        const match = path.match(ORDER_PATH);
        setView(match ? { kind: 'order', orderId: decodeURIComponent(match[1]) } : { kind: 'account' });
    }, [sessionOk, userId, auth.user]);

    if (view.kind === 'generic') return <>{children}</>;
    if (view.kind === 'admin') return <AdminOfflineView path={view.path} />;

    return (
        <div data-testid="offline-account">
            <Header />
            {/* AccountClient lee ?tab= de la URL: en una página estática eso exige un límite de Suspense */}
            <Suspense fallback={null}>{view.kind === 'order' ? <OrderDetailClient orderId={view.orderId} /> : <AccountClient />}</Suspense>
            <div className={styles.card} style={{ maxWidth: 720, margin: '0 auto 2rem', width: 'calc(100% - 32px)' }}>
                <p className={styles.hint} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <CloudOff size={18} aria-hidden="true" />
                    {t('offlineAccountNote')}
                </p>
            </div>
        </div>
    );
}
