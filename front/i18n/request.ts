import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_HEADER, isLocale, negotiateLocale, type Locale } from "./config";

// next-intl "sin enrutamiento i18n": el idioma de cada request se resuelve acá, no desde la URL.
// Orden: cookie elegida por el usuario → idioma que negoció el proxy → Accept-Language → español.
// (El proxy ya negocia en la primera visita; el Accept-Language de acá cubre requests que no pasan
// por el proxy, como los estáticos que excluye su matcher.)
async function resolveLocale(): Promise<Locale> {
    const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
    if (isLocale(cookieLocale)) return cookieLocale;

    const requestHeaders = await headers();
    const proxyLocale = requestHeaders.get(LOCALE_HEADER);
    if (isLocale(proxyLocale)) return proxyLocale;

    return negotiateLocale(requestHeaders.get("accept-language")) ?? DEFAULT_LOCALE;
}

export default getRequestConfig(async () => {
    const locale = await resolveLocale();
    return {
        locale,
        messages: (await import(`../messages/${locale}.json`)).default,
    };
});
