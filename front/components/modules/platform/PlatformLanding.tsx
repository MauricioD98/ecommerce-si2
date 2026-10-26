import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowRight, BarChart3, CreditCard, Globe2, Languages, Package, Store } from "lucide-react";
import { PricingCards } from "./PricingCards";
import styles from "./landing.module.scss";

// Funciones que el producto ya tiene de verdad (sin cifras ni testimonios inventados)
const FEATURES = [
    { key: "storefront", icon: Store },
    { key: "payments", icon: CreditCard },
    { key: "pos", icon: Package },
    { key: "inventory", icon: Globe2 },
    { key: "reports", icon: BarChart3 },
    { key: "languages", icon: Languages },
] as const;

const STEPS = ["choose", "details", "pay"] as const;
const FAQ = ["domain", "change", "billing", "ready"] as const;

// Landing de ventas del SaaS (/planes). Server Component: solo PricingCards (toggle + modal) corre
// en el navegador. La navegación y el selector de idioma vienen del layout de (platform).
export function PlatformLanding({ cancelled = false }: { cancelled?: boolean }) {
    const t = useTranslations("Landing");
    const tPricing = useTranslations("Pricing");

    return (
        <main className={styles.landing}>
            <section className={styles.hero}>
                <p className={styles.eyebrow}>{t("hero.eyebrow")}</p>
                <h1>{t("hero.title")}</h1>
                <p className={styles.heroSubtitle}>{t("hero.subtitle")}</p>
                <div className={styles.heroActions}>
                    <a href="#precios" className={styles.buttonPrimary}>
                        {t("hero.primary")} <ArrowRight size={18} aria-hidden />
                    </a>
                    <Link href="/contacto" className={styles.buttonGhost}>
                        {t("hero.secondary")}
                    </Link>
                </div>
                <p className={styles.heroNote}>{t("hero.note")}</p>
            </section>

            <section id="funciones" className={styles.section}>
                <header className={styles.sectionHeader}>
                    <p className={styles.eyebrow}>{t("features.eyebrow")}</p>
                    <h2>{t("features.title")}</h2>
                </header>
                <div className={styles.featureGrid}>
                    {FEATURES.map(({ key, icon: Icon }) => (
                        <article key={key} className={styles.feature}>
                            <Icon size={24} strokeWidth={1.75} aria-hidden />
                            <h3>{t(`features.items.${key}.title`)}</h3>
                            <p>{t(`features.items.${key}.text`)}</p>
                        </article>
                    ))}
                </div>
            </section>

            <section className={`${styles.section} ${styles.sectionDark}`}>
                <header className={styles.sectionHeader}>
                    <p className={styles.eyebrow}>{t("steps.eyebrow")}</p>
                    <h2>{t("steps.title")}</h2>
                </header>
                <ol className={styles.steps}>
                    {STEPS.map((step, index) => (
                        <li key={step}>
                            <span className={styles.stepNumber}>{String(index + 1).padStart(2, "0")}</span>
                            <h3>{t(`steps.items.${step}.title`)}</h3>
                            <p>{t(`steps.items.${step}.text`)}</p>
                        </li>
                    ))}
                </ol>
            </section>

            <section id="precios" className={styles.section}>
                <header className={styles.sectionHeader}>
                    <p className={styles.eyebrow}>{t("pricingEyebrow")}</p>
                    <h2>{tPricing("title")}</h2>
                    <p>{tPricing("subtitle")}</p>
                    {cancelled && <p className={styles.notice}>{tPricing("cancelled")}</p>}
                </header>
                <PricingCards />
            </section>

            <section id="preguntas" className={styles.section}>
                <header className={styles.sectionHeader}>
                    <p className={styles.eyebrow}>{t("faq.eyebrow")}</p>
                    <h2>{t("faq.title")}</h2>
                </header>
                <div className={styles.faq}>
                    {FAQ.map((item) => (
                        <details key={item}>
                            <summary>{t(`faq.items.${item}.question`)}</summary>
                            <p>{t(`faq.items.${item}.answer`)}</p>
                        </details>
                    ))}
                </div>
            </section>

            <section className={styles.ctaBand}>
                <h2>{t("cta.title")}</h2>
                <p>{t("cta.subtitle")}</p>
                <a href="#precios" className={styles.buttonInverse}>
                    {t("cta.button")} <ArrowRight size={18} aria-hidden />
                </a>
            </section>
        </main>
    );
}
