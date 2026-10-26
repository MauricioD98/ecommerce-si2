'use client';

import React, { useEffect } from 'react';
import { getClientLocale } from '@/i18n/client';
import type { Locale } from '@/i18n/config';

// Este componente reemplaza al layout raíz, así que queda fuera de NextIntlClientProvider y no puede
// usar useTranslations: sus pocos textos van acá, uno por idioma (el tipo obliga a tener los 4).
const TEXTS: Record<Locale, { offlineTitle: string; title: string; offline: string; message: string; reload: string }> = {
    es: {
        offlineTitle: 'Estás sin conexión',
        title: 'Algo salió mal',
        offline: 'Parece que estás offline y no tenemos esta página guardada en tu dispositivo.',
        message: 'La aplicación tuvo un error inesperado al cargar.',
        reload: 'Recargar página',
    },
    en: {
        offlineTitle: 'You’re offline',
        title: 'Something went wrong',
        offline: 'It looks like you’re offline and this page isn’t saved on your device.',
        message: 'The app ran into an unexpected error while loading.',
        reload: 'Reload page',
    },
    fr: {
        offlineTitle: 'Vous êtes hors ligne',
        title: 'Un problème est survenu',
        offline: 'Vous semblez hors ligne et cette page n’est pas enregistrée sur votre appareil.',
        message: 'L’application a rencontré une erreur inattendue au chargement.',
        reload: 'Recharger la page',
    },
    zh: {
        offlineTitle: '你已离线',
        title: '出现问题',
        offline: '你似乎处于离线状态，而此页面未保存在设备上。',
        message: '应用加载时发生意外错误。',
        reload: '重新加载页面',
    },
};

// Salvavidas final: solo se activa si el error ocurre en el layout raíz mismo (Providers,
// OfflineSyncProvider) — algo que app/error.tsx NO puede atrapar, porque error.tsx envuelve todo lo
// que está DEBAJO del layout raíz, no el layout raíz en sí.
//
// Reemplaza layout.tsx por completo cuando se activa, así que no hereda globals.css ni las fuentes:
// todo el estilo va inline, a propósito, para que se vea bien incluso si lo que falló fue la app entera.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
    useEffect(() => {
        console.error('Error crítico atrapado por global-error:', error);
    }, [error]);

    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
    const locale = getClientLocale();
    const text = TEXTS[locale];

    return (
        <html lang={locale}>
            <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#f9fafb' }}>
                <div
                    style={{
                        minHeight: '100vh',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '1.5rem',
                    }}
                >
                    <div
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '0.75rem',
                            maxWidth: 360,
                            padding: '2.5rem 2rem',
                            textAlign: 'center',
                            background: '#fff',
                            border: '1px solid #e5e7eb',
                            borderRadius: '0.75rem',
                            color: '#6b7280',
                        }}
                    >
                        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#171717', margin: 0 }}>
                            {isOffline ? text.offlineTitle : text.title}
                        </h1>
                        <p style={{ fontSize: '0.9375rem', lineHeight: 1.5, margin: 0 }}>
                            {isOffline ? text.offline : text.message}
                        </p>
                        <button
                            type="button"
                            onClick={() => window.location.reload()}
                            style={{
                                marginTop: '0.5rem',
                                padding: '0.625rem 1.5rem',
                                background: '#000',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '0.5rem',
                                fontSize: '0.9375rem',
                                fontWeight: 600,
                                fontFamily: 'inherit',
                                cursor: 'pointer',
                            }}
                        >
                            {text.reload}
                        </button>
                    </div>
                </div>
            </body>
        </html>
    );
}
