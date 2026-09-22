import type { MetadataRoute } from "next";

// Convención de Next (App Router): este archivo se sirve automáticamente en /manifest.webmanifest
// y Next inyecta el <link rel="manifest"> solo. No requiere next-pwa ni ninguna otra herramienta.
export default function manifest(): MetadataRoute.Manifest {
    return {
        name: "Stella Femme",
        short_name: "Stella Femme",
        description: "Moda femenina con retiro en tienda o envío a domicilio en Santa Cruz de la Sierra, Bolivia.",
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
