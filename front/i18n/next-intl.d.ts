import type { Locale } from "./config";
import type messages from "../messages/es.json";

// Tipado de next-intl: t("Pricing.titel") o un idioma fuera de LOCALES fallan al compilar.
// es.json es la referencia; los otros diccionarios tienen que tener las mismas claves.
declare module "next-intl" {
    interface AppConfig {
        Locale: Locale;
        Messages: typeof messages;
    }
}
