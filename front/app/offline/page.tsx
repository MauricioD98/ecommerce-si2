import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getServerStoreName } from "@/utils/storeName.server";
import React from 'react';
import { WifiOff } from 'lucide-react';
import styles from './offline.module.scss';

export const revalidate = false;

// Fallback que el Service Worker sirve cuando una navegación falla por falta de red y la URL
// pedida tampoco está en caché (ver public/sw.js). Ruta simple, sin datos ni llamadas a la API,
// para que siempre esté disponible sin conexión.
export default async function OfflinePage() {
    const t = await getTranslations('ErrorPage');
    const store = await getServerStoreName();

    return (
        <main className={styles.page}>
            <div className={styles.card}>
                <WifiOff size={40} strokeWidth={1.75} />
                <h1>{t('offlineTitle')}</h1>
                <p>{t('offlineDescription', { store })}</p>
                {/* <a> real, no <Link>: esta página se sirve realmente offline (fallback del service
                    worker). <Link> haría un fetch de datos RSC que no pasa por el navigate del SW y
                    fallaría en silencio; un <a> fuerza una navegación completa, que el SW sí intercepta
                    y puede resolver desde caché o volver a caer acá mismo. */}
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                <a href="/">{t('backHome')}</a>
            </div>
        </main>
    );
}

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("Metadata");
    return {
        title: t("offlineTitle"),
        description: t("offlineDescription"),
    };
}
