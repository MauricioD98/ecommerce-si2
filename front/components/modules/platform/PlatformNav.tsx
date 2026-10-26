import Link from "next/link";
import { useTranslations } from "next-intl";
import LanguageSwitcher from "@/components/modules/i18n/LanguageSwitcher";
import styles from "./landing.module.scss";

// Barra superior de las páginas del SaaS (/planes, /contacto, /planes/exito): marca, anclas de la
// landing y selector de idioma. No es el Header de la tienda (carrito, sucursal…).
export function PlatformNav() {
    const t = useTranslations("Landing");

    return (
        <header className={styles.nav}>
            <div className={styles.navInner}>
                <Link href="/planes" className={styles.brand}>
                    STELLA FEMME
                </Link>
                <nav className={styles.navLinks} aria-label={t("nav.label")}>
                    <Link href="/planes#funciones">{t("nav.features")}</Link>
                    <Link href="/planes#precios">{t("nav.pricing")}</Link>
                    <Link href="/planes#preguntas">{t("nav.faq")}</Link>
                    <Link href="/contacto">{t("nav.contact")}</Link>
                </nav>
                <div className={styles.navActions}>
                    <LanguageSwitcher />
                    <Link href="/planes#precios" className={styles.navCta}>
                        {t("nav.cta")}
                    </Link>
                </div>
            </div>
        </header>
    );
}

export function PlatformFooter() {
    const t = useTranslations("Landing");

    return (
        <footer className={styles.footer}>
            <span>{t("footer.rights", { year: new Date().getFullYear() })}</span>
            <Link href="/contacto">{t("nav.contact")}</Link>
        </footer>
    );
}
