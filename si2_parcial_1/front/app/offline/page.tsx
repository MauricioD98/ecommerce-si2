import React from 'react';
import { WifiOff } from 'lucide-react';
import styles from './offline.module.scss';

export const revalidate = false;

// Fallback que el Service Worker sirve cuando una navegación falla por falta de red y la URL
// pedida tampoco está en caché (ver public/sw.js). Ruta simple, sin datos ni llamadas a la API,
// para que siempre esté disponible sin conexión.
export default function OfflinePage() {
    return (
        <main className={styles.page}>
            <div className={styles.card}>
                <WifiOff size={40} strokeWidth={1.75} />
                <h1>Estás sin conexión</h1>
                <p>
                    Algunas partes de Stella Femme no están disponibles temporalmente sin internet. Podés
                    seguir viendo el catálogo que ya cargaste antes y tu carrito sigue guardado en este
                    dispositivo.
                </p>
                {/* <a> real, no <Link>: esta página se sirve realmente offline (fallback del service
                    worker). <Link> haría un fetch de datos RSC que no pasa por el navigate del SW y
                    fallaría en silencio; un <a> fuerza una navegación completa, que el SW sí intercepta
                    y puede resolver desde caché o volver a caer acá mismo. */}
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                <a href="/">Volver al inicio</a>
            </div>
        </main>
    );
}

export function generateMetadata() {
    return {
        title: 'Sin conexión | Stella Femme',
        description: 'Estás navegando sin conexión a internet',
    };
}
