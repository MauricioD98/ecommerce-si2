"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Globe } from "lucide-react";
import { LOCALES, LOCALE_LABELS, isLocale } from "@/i18n/config";
import { setClientLocale } from "@/i18n/client";
import styles from "./language-switcher.module.scss";

// Cambia el idioma sin recargar la página: guarda la cookie NEXT_LOCALE y router.refresh() vuelve a
// renderizar los Server Components con los mensajes nuevos (NextIntlClientProvider los propaga a los
// componentes cliente). El carrito, la sesión y el resto del estado de Redux se conservan.
//
// Lo que ya se trajo de la API (nombres de producto, etc.) queda en el idioma anterior hasta el
// siguiente fetch: las peticiones nuevas salen con Accept-Language del idioma elegido.
export default function LanguageSwitcher({ className }: { className?: string }) {
    const locale = useLocale();
    const t = useTranslations("LanguageSwitcher");
    const router = useRouter();
    const [pending, startTransition] = useTransition();

    const onChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const next = event.target.value;
        if (!isLocale(next) || next === locale) return;
        setClientLocale(next);
        startTransition(() => router.refresh());
    };

    return (
        <label className={`${styles.switcher} ${className ?? ""}`} title={t("label")}>
            <Globe size={16} aria-hidden className={styles.icon} />
            <span className={styles.srOnly}>{t("label")}</span>
            <select value={locale} onChange={onChange} disabled={pending} aria-busy={pending}>
                {LOCALES.map((code) => (
                    // lang: cada opción la pronuncia el lector de pantalla en su propio idioma
                    <option key={code} value={code} lang={code}>
                        {LOCALE_LABELS[code]}
                    </option>
                ))}
            </select>
        </label>
    );
}
