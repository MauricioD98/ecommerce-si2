// Idiomas del front. Sin prefijo en la URL (/es/..., /en/...): el idioma vive en la cookie NEXT_LOCALE.
// Así no cambian las rutas que ya usan el service worker, los QR del POS, los enlaces de los correos
// ni el enrutamiento por dominio de cada tienda (front/proxy.ts).
//
// Este archivo no importa nada de Next ni de next-intl: lo usan el proxy, i18n/request.ts y el cliente.

export const LOCALES = ["es", "en", "fr", "zh"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "es";

// Nombre que next-intl usa por convención; lo escribe el proxy (primera visita) y el LanguageSwitcher
export const LOCALE_COOKIE = "NEXT_LOCALE";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

// Lo pone el proxy en el request cuando todavía no hay cookie (primera visita): i18n/request.ts lo lee
// para renderizar ya en el idioma negociado, sin esperar a que el navegador devuelva la cookie.
export const LOCALE_HEADER = "x-locale";

// Cada idioma escrito en sí mismo: es lo que reconoce quien no entiende el idioma actual de la página
export const LOCALE_LABELS: Record<Locale, string> = {
    es: "Español",
    en: "English",
    fr: "Français",
    zh: "中文",
};

// Etiqueta BCP 47 completa para Intl (fechas, números) y el dictado por voz. El español mantiene el
// formato boliviano (1.234,50) que la tienda ya usaba.
export const INTL_LOCALES: Record<Locale, string> = {
    es: "es-BO",
    en: "en-US",
    fr: "fr-FR",
    zh: "zh-CN",
};

export function intlLocale(locale: string): string {
    return isLocale(locale) ? INTL_LOCALES[locale] : INTL_LOCALES[DEFAULT_LOCALE];
}

// Montos en bolivianos con el separador decimal del idioma: "Bs 1.234,50" / "Bs 1,234.50"
export function formatMoney(value: number, locale: string): string {
    return `Bs ${value.toLocaleString(intlLocale(locale), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function isLocale(value: string | null | undefined): value is Locale {
    return !!value && (LOCALES as readonly string[]).includes(value);
}

// "fr-CA" → "fr", "zh-Hans-CN" → "zh". Solo se ofrece la variante general de cada idioma.
function baseLanguage(tag: string): string {
    return tag.trim().toLowerCase().split(/[-_]/)[0];
}

/**
 * Elige el idioma a partir de Accept-Language ("fr-CA,fr;q=0.9,en;q=0.8"), respetando los pesos q.
 * Devuelve null si ninguno de los pedidos está soportado.
 */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale | null {
    if (!acceptLanguage) return null;

    const ranked = acceptLanguage
        .split(",")
        .map((part, index) => {
            const [tag, ...params] = part.split(";");
            const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
            const weight = q ? Number(q.slice(2)) : 1;
            return { language: baseLanguage(tag), weight: Number.isFinite(weight) ? weight : 0, index };
        })
        .filter((entry) => entry.language && entry.weight > 0)
        // A igual peso gana el que el navegador listó primero
        .sort((a, b) => b.weight - a.weight || a.index - b.index);

    return ranked.map((entry) => entry.language).find(isLocale) ?? null;
}
