"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { PLANS, type Plan } from "./plans";
import { OnboardingModal } from "./OnboardingModal";
import styles from "./landing.module.scss";

type Billing = "monthly" | "annual";

// Tarjetas de precios con toggle mensual/anual. En Stripe solo existen los Prices mensuales, así que
// "Anual" se muestra deshabilitado ("Próximamente") en vez de anunciar un precio que no se cobra.
// Elegir un plan abre el OnboardingModal, que crea la sesión de Stripe Checkout.
export function PricingCards() {
    const t = useTranslations("Pricing");
    const tPlans = useTranslations("Plans");
    const [billing, setBilling] = useState<Billing>("monthly");
    const [selected, setSelected] = useState<Plan | null>(null);

    return (
        <>
            <div className={styles.billingToggle} role="radiogroup" aria-label={t("billingLabel")}>
                <button
                    type="button"
                    role="radio"
                    aria-checked={billing === "monthly"}
                    className={billing === "monthly" ? styles.billingActive : ""}
                    onClick={() => setBilling("monthly")}
                >
                    {t("monthly")}
                </button>
                <button type="button" role="radio" aria-checked={false} disabled aria-describedby="annual-soon">
                    {t("annual")}
                    <span id="annual-soon" className={styles.soon}>{t("soon")}</span>
                </button>
            </div>

            <div className={styles.cards}>
                {PLANS.map((plan) => (
                    <article key={plan.key} className={`${styles.card} ${plan.highlighted ? styles.cardFeatured : ""}`}>
                        <header className={styles.cardHeader}>
                            <h3>{plan.name}</h3>
                            {plan.highlighted && <span className={styles.cardBadge}>{t("popular")}</span>}
                        </header>
                        <p className={styles.cardDescription}>{tPlans(`${plan.key}.description`)}</p>
                        <p className={styles.cardPrice}>
                            {plan.price}
                            <span>{t("perMonth")}</span>
                        </p>
                        <button
                            type="button"
                            className={plan.highlighted ? styles.buttonInverse : styles.buttonPrimary}
                            onClick={() => setSelected(plan)}
                        >
                            {t("choose", { plan: plan.name })}
                        </button>
                        <ul className={styles.cardFeatures}>
                            {(tPlans.raw(`${plan.key}.features`) as string[]).map((feature) => (
                                <li key={feature}>
                                    <Check size={16} aria-hidden /> {feature}
                                </li>
                            ))}
                        </ul>
                    </article>
                ))}
            </div>

            {selected && <OnboardingModal plan={selected} onClose={() => setSelected(null)} />}
        </>
    );
}
