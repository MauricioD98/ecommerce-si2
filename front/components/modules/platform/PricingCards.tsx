"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { BILLING_INTERVALS, PLANS, formatPlanPrice, type BillingInterval, type Plan } from "./plans";
import { OnboardingModal } from "./OnboardingModal";
import { usePlanPrices } from "@/hooks/usePlanPrices";
import styles from "./landing.module.scss";

// Tarjetas de precios con selector mensual/anual. Los montos salen de Stripe (usePlanPrices); un plan
// cuyo Price no está configurado se muestra deshabilitado en vez de fallar al pagar.
// Elegir un plan abre el OnboardingModal, que crea la sesión de Stripe Checkout con ese intervalo.
export function PricingCards() {
    const t = useTranslations("Pricing");
    const tPlans = useTranslations("Plans");
    const [billing, setBilling] = useState<BillingInterval>("monthly");
    const [selected, setSelected] = useState<Plan | null>(null);
    const { priceOf } = usePlanPrices();

    return (
        <>
            <div className={styles.billingToggle} role="radiogroup" aria-label={t("billingLabel")}>
                {BILLING_INTERVALS.map((interval) => (
                    <button
                        key={interval}
                        type="button"
                        role="radio"
                        aria-checked={billing === interval}
                        className={billing === interval ? styles.billingActive : ""}
                        onClick={() => setBilling(interval)}
                    >
                        {t(interval)}
                        {interval === "annual" && <span className={styles.soon}>{t("annualBadge")}</span>}
                    </button>
                ))}
            </div>

            <div className={styles.cards}>
                {PLANS.map((plan) => {
                    const price = priceOf(plan.key, billing);
                    const monthly = priceOf(plan.key, "monthly");
                    const saving = monthly.amount * 12 - price.amount;
                    return (
                        <article key={plan.key} className={`${styles.card} ${plan.highlighted ? styles.cardFeatured : ""}`}>
                            <header className={styles.cardHeader}>
                                <h3>{plan.name}</h3>
                                {plan.highlighted && <span className={styles.cardBadge}>{t("popular")}</span>}
                            </header>
                            <p className={styles.cardDescription}>{tPlans(`${plan.key}.description`)}</p>
                            <p className={styles.cardPrice}>
                                {formatPlanPrice(price.amount, price.currency)}
                                <span>{billing === "annual" ? t("perYear") : t("perMonth")}</span>
                            </p>
                            {billing === "annual" && (
                                <p className={styles.cardDescription} style={{ marginTop: "0.75rem", fontSize: "0.875rem" }}>
                                    {t("annualEquivalent", { price: formatPlanPrice(price.amount / 12, price.currency) })}
                                    {saving > 0.005 && ` · ${t("annualSaving", { amount: formatPlanPrice(saving, price.currency) })}`}
                                </p>
                            )}
                            <button
                                type="button"
                                className={plan.highlighted ? styles.buttonInverse : styles.buttonPrimary}
                                onClick={() => setSelected(plan)}
                                disabled={!price.available}
                                title={price.available ? undefined : t("unavailable")}
                            >
                                {price.available ? t("choose", { plan: plan.name }) : t("unavailable")}
                            </button>
                            <ul className={styles.cardFeatures}>
                                {(tPlans.raw(`${plan.key}.features`) as string[]).map((feature) => (
                                    <li key={feature}>
                                        <Check size={16} aria-hidden /> {feature}
                                    </li>
                                ))}
                            </ul>
                        </article>
                    );
                })}
            </div>

            {selected && (
                <OnboardingModal
                    plan={selected}
                    interval={billing}
                    price={priceOf(selected.key, billing)}
                    onClose={() => setSelected(null)}
                />
            )}
        </>
    );
}
