import { NextResponse } from "next/server";
import { getServerStoreAppearance } from "@/utils/storeAppearance.server";
import { getServerStoreName, getServerTenantId } from "@/utils/storeName.server";

// Route Handler (y no app/manifest.ts, ni una ruta llamada manifest.webmanifest, que Next trata como metadato
// e inyecta un segundo enlace sin tienda) porque necesita leer ?tenant=: en el host compartido de la plataforma
// la tienda no se deduce del dominio, y el navegador pide el manifest sin cookies. El layout declara el enlace.
export async function GET(request: Request) {
    const requested = new URL(request.url).searchParams.get("tenant");
    const tenantId = await getServerTenantId(requested);
    const [store, appearance] = await Promise.all([getServerStoreName(tenantId), getServerStoreAppearance(tenantId)]);
    const suffix = tenantId && requested ? `?tenant=${encodeURIComponent(tenantId)}` : "";
    const icon = (size: number, purpose: "any" | "maskable") => ({
        src: `/pwa-icon/${size}${purpose === "maskable" ? "/maskable" : ""}${suffix}`,
        sizes: `${size}x${size}`,
        type: "image/png",
        purpose,
    });

    return NextResponse.json(
        {
            // id estable por tienda: dos tiendas en el mismo host son dos apps instaladas distintas
            id: `/${suffix}`,
            name: store,
            short_name: store.length > 12 ? store.slice(0, 12) : store,
            description: appearance.description ?? store,
            scope: "/",
            start_url: `/${suffix}`,
            display: "standalone",
            background_color: appearance.secondaryColor,
            theme_color: appearance.primaryColor,
            icons: [icon(192, "any"), icon(512, "any"), icon(192, "maskable"), icon(512, "maskable")],
        },
        { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-cache" } },
    );
}
