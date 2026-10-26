import {
    APPEARANCE_COLOR_FIELDS,
    AppearanceColorField,
    DEFAULT_APPEARANCE,
    FONT_FAMILIES,
    FontFamily,
    StoreAppearance,
    appearanceCacheTag,
} from "@/types/appearance.types";
import { SERVER_API_URL, getServerTenantId } from "./storeName.server";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * Apariencia de la tienda para el layout (Server Components): colores, logo, favicon y descripción.
 * Misma resolución de tienda que getServerStoreName. Sin tienda conocida, o si la API no responde,
 * devuelve los valores por defecto (la tienda se ve como siempre, no se rompe).
 */
export async function getServerStoreAppearance(): Promise<StoreAppearance> {
    const tenantId = await getServerTenantId();
    if (!tenantId) return DEFAULT_APPEARANCE;

    try {
        const response = await fetch(`${SERVER_API_URL}/store/appearance`, {
            headers: { "x-tenant-id": tenantId },
            // La clave de caché incluye el id (la URL es la misma para todas las tiendas). Al guardar en
            // el panel se expira el tag (app/actions/appearance.ts) y el cambio se ve en el acto.
            next: { revalidate: 300, tags: [appearanceCacheTag(tenantId)] },
        });
        if (!response.ok) return DEFAULT_APPEARANCE;
        const { data } = (await response.json()) as { data?: Partial<StoreAppearance> };
        if (!data) return DEFAULT_APPEARANCE;
        // Van a variables CSS: solo #rrggbb (el backend ya lo valida; acá es la segunda barrera)
        const colors = Object.fromEntries(
            APPEARANCE_COLOR_FIELDS.map((field) => {
                const value = data[field];
                return [field, value && HEX_COLOR.test(value) ? value : DEFAULT_APPEARANCE[field]];
            }),
        ) as Pick<StoreAppearance, AppearanceColorField>;
        return {
            ...colors,
            logoUrl: data.logoUrl || null,
            faviconUrl: data.faviconUrl || null,
            description: data.description?.trim() || null,
            socialLinks: Array.isArray(data.socialLinks) ? data.socialLinks : null,
            fontFamily: FONT_FAMILIES.includes(data.fontFamily as FontFamily) ? (data.fontFamily as FontFamily) : DEFAULT_APPEARANCE.fontFamily,
            storeBackgroundImage: data.storeBackgroundImage || null,
            updatedAt: data.updatedAt ?? null,
        };
    } catch {
        return DEFAULT_APPEARANCE;
    }
}
