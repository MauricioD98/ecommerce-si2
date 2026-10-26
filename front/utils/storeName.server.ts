import { cookies } from "next/headers";
import { PLATFORM_BRAND, STORE_HINT_COOKIE } from "./storeName";

const API_URL = (process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1").replace(/\/+$/, "");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Nombre de la tienda para metadatos y manifest (Server Components). Orden: cookie del dominio propio
 * (la pone front/proxy.ts) → la tienda que eligió el navegador (StoreInfoProvider) → la tienda fija
 * del despliegue. Sin tienda conocida, o si la API no responde, cae en la marca de la plataforma.
 */
export async function getServerStoreName(): Promise<string> {
    const jar = await cookies();
    const tenantId = [jar.get("sf_tenant")?.value, jar.get(STORE_HINT_COOKIE)?.value, process.env.NEXT_PUBLIC_TENANT_ID]
        .map((value) => value?.trim().toLowerCase())
        .find((value) => value && UUID_RE.test(value));
    if (!tenantId) return PLATFORM_BRAND;

    try {
        const response = await fetch(`${API_URL}/store`, {
            headers: { "x-tenant-id": tenantId },
            // El nombre casi nunca cambia: se cachea por tienda (la URL es la misma, el header no,
            // así que la clave incluye el id)
            next: { revalidate: 300, tags: [`store-name:${tenantId}`] },
        });
        if (!response.ok) return PLATFORM_BRAND;
        const body = (await response.json()) as { data?: { name?: string } };
        return body.data?.name?.trim() || PLATFORM_BRAND;
    } catch {
        return PLATFORM_BRAND;
    }
}
