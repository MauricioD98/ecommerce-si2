'use client';

import React, { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import styles from './error.module.scss';

// Error Boundary del App Router: Next.js envuelve automáticamente cada segmento de ruta con este
// componente (convención de archivo, no hace falta importarlo en ningún lado). Atrapa errores de
// renderizado/hidratación que se les escapen a los try/catch de los componentes — por ejemplo, un
// chunk de JS que falló al cargar offline y nunca se cacheó — y evita la pantalla en blanco.
//
// No cubre errores lanzados por el propio layout raíz (Providers/OfflineSyncProvider): para eso
// existe app/global-error.tsx, que es el único que también puede atraparlos.
export default function RouteError({ error }: { error: Error & { digest?: string } }) {
    const t = useTranslations('ErrorPage');

    useEffect(() => {
        console.error('Error de renderizado atrapado por el Error Boundary:', error);
    }, [error]);

    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

    return (
        <div className={styles.page}>
            <div className={styles.card}>
                <AlertTriangle size={40} strokeWidth={1.75} />
                <h1>{t('title')}</h1>
                <p>
                    {isOffline ? t('offlineMessage') : t('message')}
                </p>
                {/* Recarga completa (no reset()/retry()): si la causa fue un chunk de JS que nunca
                    llegó a cargar, lo correcto es volver a pedir la página entera, no solo re-renderizar
                    el árbol ya cargado */}
                <button type="button" onClick={() => window.location.reload()}>
                    <RefreshCw size={16} />
                    {t('reload')}
                </button>
            </div>
        </div>
    );
}
