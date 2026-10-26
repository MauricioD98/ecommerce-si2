"use client";

import { FormEvent, useEffect, useState } from "react";
import { Eye, EyeOff, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { platformService } from "@/service/api/platform.service";
import { getApiErrorMessage } from "@/service/api/error.utils";
import type { Plan } from "./plans";
import styles from "./platform.module.scss";

interface FormState {
    tenantName: string;
    domain: string;
    adminEmail: string;
    adminPassword: string;
}

const EMPTY: FormState = { tenantName: "", domain: "", adminEmail: "", adminPassword: "" };

// Mismas reglas que valida el backend (SubscriptionCheckoutDto): se avisan acá para no gastar un
// ida y vuelta, pero la validación que cuenta es la del servidor. Devuelve la clave del mensaje
// (Onboarding.errors.*), que se traduce al mostrarla.
type FormError = "tenantName" | "domain" | "email" | "password";

function validate(form: FormState): FormError | null {
    if (form.tenantName.trim().length < 2) return "tenantName";
    if (form.domain.trim() && !/^(https?:\/\/)?(www\.)?([a-z0-9-]+\.)+[a-z]{2,}\/?$/i.test(form.domain.trim())) {
        return "domain";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.adminEmail.trim())) return "email";
    if (form.adminPassword.length < 8 || !/[A-Za-z]/.test(form.adminPassword) || !/\d/.test(form.adminPassword)) {
        return "password";
    }
    return null;
}

// Modal de alta: datos de la tienda y del dueño → POST /platform/subscriptions/checkout → Stripe Checkout
export function OnboardingModal({ plan, onClose }: { plan: Plan; onClose: () => void }) {
    const t = useTranslations("Onboarding");
    const tCommon = useTranslations("Common");
    const tPricing = useTranslations("Pricing");
    const [form, setForm] = useState<FormState>(EMPTY);
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => e.key === "Escape" && !loading && onClose();
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [loading, onClose]);

    const update = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
        setForm((prev) => ({ ...prev, [field]: e.target.value }));

    const onSubmit = async (event: FormEvent) => {
        event.preventDefault();
        const invalid = validate(form);
        if (invalid) return setError(t(`errors.${invalid}`));

        setLoading(true);
        setError(null);
        try {
            const { url } = await platformService.createCheckout({
                plan: plan.key,
                tenantName: form.tenantName.trim(),
                domain: form.domain.trim() || undefined,
                adminEmail: form.adminEmail.trim(),
                adminPassword: form.adminPassword,
            });
            // Stripe Checkout (pago recurrente). Al volver, /planes/exito sigue el alta de la tienda.
            window.location.assign(url);
        } catch (err) {
            setError(getApiErrorMessage(err, t("errors.checkout")));
            setLoading(false);
        }
    };

    return (
        <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
            <form className={styles.modal} onSubmit={onSubmit} noValidate>
                <button type="button" className={styles.close} onClick={onClose} disabled={loading} aria-label={tCommon("close")}>
                    <X size={20} />
                </button>
                <h2 id="onboarding-title">
                    {t("title", { plan: plan.name, price: plan.price, period: tPricing("perMonth") })}
                </h2>
                <p className={styles.muted}>{t("intro")}</p>

                <label className={styles.field}>
                    {t("tenantName")}
                    <input value={form.tenantName} onChange={update("tenantName")} maxLength={80} autoFocus required disabled={loading} />
                </label>

                <label className={styles.field}>
                    {/* En un solo span: el label es columna flex y si no "(opcional)" cae en otra línea */}
                    <span>
                        {t("domain")} <span className={styles.optional}>{tCommon("optional")}</span>
                    </span>
                    <input
                        value={form.domain}
                        onChange={update("domain")}
                        placeholder="boutiquemia.com"
                        autoCapitalize="none"
                        spellCheck={false}
                        disabled={loading}
                    />
                    <small>{t("domainHint")}</small>
                </label>

                <label className={styles.field}>
                    {t("adminEmail")}
                    <input type="email" value={form.adminEmail} onChange={update("adminEmail")} autoComplete="email" required disabled={loading} />
                </label>

                <label className={styles.field}>
                    {t("adminPassword")}
                    <span className={styles.passwordWrap}>
                        <input
                            type={showPassword ? "text" : "password"}
                            value={form.adminPassword}
                            onChange={update("adminPassword")}
                            autoComplete="new-password"
                            minLength={8}
                            maxLength={72}
                            required
                            disabled={loading}
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword((v) => !v)}
                            aria-label={showPassword ? t("hidePassword") : t("showPassword")}
                        >
                            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                    </span>
                    <small>{t("passwordHint")}</small>
                </label>

                {error && <p className={styles.error}>{error}</p>}

                <button type="submit" className={styles.primary} disabled={loading}>
                    {loading ? <Loader2 size={18} className={styles.spin} /> : t("submit")}
                </button>
            </form>
        </div>
    );
}
