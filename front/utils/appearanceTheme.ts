import type React from "react";
import { readableTextOn, StoreAppearance } from "@/types/appearance.types";

// Ruta del Route Handler que sirve la imagen de fondo subida (app/store-assets/background/route.ts)
export const BACKGROUND_ASSET_PATH = "/store-assets/background";

/**
 * Valor CSS de --store-bg-image. Una URL externa va tal cual; un data URL NO se pone en el HTML (pesaría
 * cientos de KB en cada página): se pide al Route Handler, versionado para que el navegador lo cachee.
 * JSON.stringify deja la URL entre comillas y escapada: no puede cerrar el url(...) ni la declaración.
 */
export function backgroundImageCss(image: string | null, version?: string | null): string {
    if (!image) return "none";
    if (image.startsWith("data:")) {
        return `url(${JSON.stringify(`${BACKGROUND_ASSET_PATH}?v=${encodeURIComponent(version ?? "0")}`)})`;
    }
    return `url(${JSON.stringify(image)})`;
}

/**
 * Variables CSS de la tienda. Las usan el <body> (app/layout.tsx) y la vista previa del panel, así
 * que lo que se ve en la vista previa es exactamente lo que verá el cliente.
 */
export function appearanceCssVars(appearance: StoreAppearance, backgroundImage: string): React.CSSProperties {
    return {
        "--color-primary": appearance.primaryColor,
        "--color-secondary": appearance.secondaryColor,
        "--navbar-bg": appearance.navbarBackgroundColor,
        "--navbar-text": appearance.navbarTextColor,
        "--search-bg": appearance.searchBarBackgroundColor,
        "--search-text": readableTextOn(appearance.searchBarBackgroundColor),
        "--store-bg-color": appearance.storeBackgroundColor,
        "--store-bg-image": backgroundImage,
        "--admin-menu-bg": appearance.adminMenuColor,
        "--admin-menu-text": readableTextOn(appearance.adminMenuColor),
    } as React.CSSProperties;
}
