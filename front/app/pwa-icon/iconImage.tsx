import { ImageResponse } from "next/og";
import { getServerStoreAppearance } from "@/utils/storeAppearance.server";
import { getServerStoreName, getServerTenantId } from "@/utils/storeName.server";

const ALLOWED_SIZES = new Set([180, 192, 512]);

// Ícono real en PNG, con la inicial y el color de cada tienda. "maskable" deja la marca dentro de la zona
// segura del 80 % que el launcher de Android no recorta.
export async function renderStoreIcon(request: Request, rawSize: string, maskable: boolean): Promise<Response> {
    const size = Number(rawSize);
    if (!ALLOWED_SIZES.has(size)) return new Response(null, { status: 404 });

    const tenantId = await getServerTenantId(new URL(request.url).searchParams.get("tenant"));
    const [store, appearance] = await Promise.all([getServerStoreName(tenantId), getServerStoreAppearance(tenantId)]);
    const letter = (store.trim()[0] ?? "S").toUpperCase();

    const image = new ImageResponse(
        (
            <div
                style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: appearance.primaryColor,
                    color: appearance.secondaryColor,
                    fontSize: size * (maskable ? 0.42 : 0.6),
                    fontWeight: 700,
                }}
            >
                {letter}
            </div>
        ),
        { width: size, height: size },
    );
    image.headers.set("Cache-Control", "public, max-age=3600");
    return image;
}
