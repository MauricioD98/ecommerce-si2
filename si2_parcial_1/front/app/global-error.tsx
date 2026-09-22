'use client';

import React, { useEffect } from 'react';

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

    return (
        <html lang="es">
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
                            {isOffline ? 'Estás sin conexión' : 'Algo salió mal'}
                        </h1>
                        <p style={{ fontSize: '0.9375rem', lineHeight: 1.5, margin: 0 }}>
                            {isOffline
                                ? 'Parece que estás offline y no tenemos esta página guardada en tu dispositivo.'
                                : 'La aplicación tuvo un error inesperado al cargar.'}
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
                            Recargar página
                        </button>
                    </div>
                </div>
            </body>
        </html>
    );
}
