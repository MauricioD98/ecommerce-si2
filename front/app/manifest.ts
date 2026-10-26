import type { MetadataRoute } from "next";
import { getServerStoreName } from "@/utils/storeName.server";

// Convención de Next (App Router): este archivo se sirve automáticamente en /manifest.webmanifest
// y Next inyecta el <link rel="manifest"> solo. No requiere next-pwa ni ninguna otra herramienta.
// La app instalada lleva el nombre de la tienda (ver utils/storeName.server.ts)
export default async function manifest(): Promise<MetadataRoute.Manifest> {
    const store = await getServerStoreName();
    return {
        name: store,
        short_name: store.length > 12 ? store.slice(0, 12) : store,
        description: store,
        start_url: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#000000",
        // TODO: reemplazar por íconos reales de 192x192 y 512x512 (PNG, fondo sólido) para que el
        // ícono de instalación en Android/iOS se vea nítido; favicon.ico es válido pero es un
        // formato/tamaño pensado para la pestaña del navegador, no para el launcher del sistema
        icons: [
            {
                src: "/favicon.ico",
                sizes: "any",
                type: "image/x-icon",
            },
        ],
    };
}
