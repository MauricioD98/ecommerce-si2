import { getServerStoreAppearance } from "@/utils/storeAppearance.server";

const DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;

// Imagen de fondo de la tienda, subida desde el panel y guardada como data URL. Se sirve acá (y no
// inline en el HTML) para que el navegador la baje una vez y la cachee: app/layout.tsx la pide como
// /store-assets/background?v=<updatedAt>, así que cambia de URL cada vez que la tienda guarda.
export async function GET() {
    const { storeBackgroundImage } = await getServerStoreAppearance();
    const match = storeBackgroundImage?.match(DATA_URL);
    if (!match) return new Response(null, { status: 404 });

    return new Response(Buffer.from(match[2], "base64"), {
        headers: {
            "Content-Type": match[1],
            // La tienda sale de una cookie: un proxy compartido no debe servir el fondo de una a otra
            "Cache-Control": "private, max-age=86400",
            "X-Content-Type-Options": "nosniff",
        },
    });
}
