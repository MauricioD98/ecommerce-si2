import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, isLocale, type Locale } from "./config";

// Lado navegador: lo usan el LanguageSwitcher (escribe) y el interceptor de Axios (lee, para mandar
// Accept-Language a la API y que traduzca errores y catálogo en el idioma elegido).

export function getClientLocale(): Locale {
    if (typeof document === "undefined") return DEFAULT_LOCALE;
    const raw = document.cookie
        .split("; ")
        .find((part) => part.startsWith(`${LOCALE_COOKIE}=`))
        ?.slice(LOCALE_COOKIE.length + 1);
    const value = raw ? decodeURIComponent(raw) : null;
    return isLocale(value) ? value : DEFAULT_LOCALE;
}

// Lo escuchan los datos que ya vinieron traducidos de la API (catálogo, carrito, pedidos) para volver a
// pedirlos: router.refresh() solo re-renderiza los Server Components, no lo que vive en estado del cliente.
export const LOCALE_CHANGED_EVENT = "locale-changed";

export function setClientLocale(locale: Locale): void {
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
    document.documentElement.lang = locale;
    // Después de la cookie: las peticiones que dispare el evento ya salen con el Accept-Language nuevo
    window.dispatchEvent(new CustomEvent(LOCALE_CHANGED_EVENT, { detail: locale }));
}
