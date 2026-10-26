import { Inter, Montserrat, Playfair_Display, Poppins, Roboto } from "next/font/google";
import type { FontFamily } from "@/types/appearance.types";

// Tipografías que la tienda puede elegir en /admin/settings/appearance. Todas declaran la MISMA variable
// (--font-store): el layout pone en <body> la clase de la elegida y globals.css usa var(--font-store).
// next/font solo descarga los archivos de la fuente que realmente se usa; preload solo para Inter,
// que es el default (precargar las cinco haría bajar las cinco en cada visita).
const inter = Inter({ variable: "--font-store", subsets: ["latin"], display: "swap" });
const playfair = Playfair_Display({ variable: "--font-store", subsets: ["latin"], display: "swap", preload: false });
const montserrat = Montserrat({ variable: "--font-store", subsets: ["latin"], display: "swap", preload: false });
const roboto = Roboto({ variable: "--font-store", subsets: ["latin"], display: "swap", preload: false });
const poppins = Poppins({
    variable: "--font-store",
    subsets: ["latin"],
    display: "swap",
    preload: false,
    weight: ["400", "500", "600", "700", "800"],
});

const STORE_FONTS: Record<FontFamily, { variable: string }> = {
    Inter: inter,
    "Playfair Display": playfair,
    Montserrat: montserrat,
    Roboto: roboto,
    Poppins: poppins,
};

/**
 * Clase de next/font para la tipografía guardada en la base. Cualquier valor fuera del catálogo
 * (dato viejo, API caída) cae en Inter.
 */
export function getStoreFontClass(fontFamily: string | null | undefined): string {
    return (STORE_FONTS[fontFamily as FontFamily] ?? inter).variable;
}
