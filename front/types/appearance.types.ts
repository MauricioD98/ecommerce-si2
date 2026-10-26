// Apariencia pública de la tienda (espejo de StoreAppearance en api/prisma/schema.prisma)

// Mismo orden que SOCIAL_PLATFORMS en api/src/modules/appearance/dto/store-appearance.dto.ts
export const SOCIAL_PLATFORMS = ["instagram", "facebook", "tiktok", "whatsapp", "x", "youtube", "website"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

// Mismo catálogo que FONT_FAMILIES en el backend; cada una está cargada en utils/fonts.ts
export const FONT_FAMILIES = ["Inter", "Playfair Display", "Montserrat", "Roboto", "Poppins"] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];

export interface SocialLink {
    platform: SocialPlatform;
    url: string;
}

export interface StoreAppearance {
    // URL https externa o data URL de la imagen subida desde el panel
    logoUrl: string | null;
    faviconUrl: string | null;
    primaryColor: string;
    secondaryColor: string;
    description: string | null;
    socialLinks: SocialLink[] | null;
    fontFamily: FontFamily;
    navbarBackgroundColor: string;
    navbarTextColor: string;
    searchBarBackgroundColor: string;
    storeBackgroundColor: string;
    // Igual que el logo: URL https o data URL. En la tienda se sirve desde /store-assets/background
    storeBackgroundImage: string | null;
    adminMenuColor: string;
    updatedAt?: string | null;
}

export type StoreAppearanceUpdate = Partial<Omit<StoreAppearance, "description">> & { description?: string };

// Lo que devuelve el backend la primera vez (y lo que se usa si la API no responde)
export const DEFAULT_APPEARANCE: StoreAppearance = {
    logoUrl: null,
    faviconUrl: null,
    primaryColor: "#000000",
    secondaryColor: "#ffffff",
    description: null,
    socialLinks: null,
    fontFamily: "Inter",
    navbarBackgroundColor: "#ffffff",
    navbarTextColor: "#000000",
    searchBarBackgroundColor: "#333333",
    storeBackgroundColor: "#ffffff",
    storeBackgroundImage: null,
    adminMenuColor: "#1a1a1a",
};

// Colores que se editan en el panel e inyectan como variables CSS (todos #rrggbb)
export const APPEARANCE_COLOR_FIELDS = [
    "primaryColor",
    "secondaryColor",
    "navbarBackgroundColor",
    "navbarTextColor",
    "searchBarBackgroundColor",
    "storeBackgroundColor",
    "adminMenuColor",
] as const;
export type AppearanceColorField = (typeof APPEARANCE_COLOR_FIELDS)[number];

// Texto legible (negro o blanco) sobre un fondo #rrggbb: para la barra de búsqueda y el menú del panel,
// donde la tienda elige solo el fondo. 0.179 es la luminancia donde ambos dan el mismo contraste WCAG.
export function readableTextOn(background: string): "#000000" | "#ffffff" {
    const [r, g, b] = [1, 3, 5].map((i) => {
        const c = parseInt(background.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? "#000000" : "#ffffff";
}

// Tag del fetch del layout; el panel lo expira al guardar (app/admin/settings/appearance/actions.ts)
export const appearanceCacheTag = (tenantId: string) => `store-appearance:${tenantId}`;
