'use client';

import styles from "./auth-form.module.scss";
import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Circle, Eye, EyeOff, Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAppDispatch } from "@/store";
import { setAuth } from "@/store/slices/authSlices";
import { authService } from "@/service/api/auth.service";
import { getApiErrorMessage } from "@/service/api/error.utils";
import { usePublicTenants } from "@/hooks/usePublicTenants";
import { getCurrentTenantId, switchTenantWithAuth } from "@/utils/tenant";

// key: Auth.requirements.<key> en messages/<idioma>.json
const PASSWORD_REQUIREMENTS = [
    { key: "minLength", test: (p: string) => p.length >= 8 },
    { key: "uppercase", test: (p: string) => /[A-Z]/.test(p) },
    { key: "lowercase", test: (p: string) => /[a-z]/.test(p) },
    { key: "number", test: (p: string) => /\d/.test(p) },
    { key: "special", test: (p: string) => /[@$!%*?&]/.test(p) },
] as const;

export default function RegisterForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const dispatch = useAppDispatch();
    const t = useTranslations("Auth");
    const { tenants, currentTenantId, isCustomDomain } = usePublicTenants();

    const [selectedTenantId, setSelectedTenantId] = useState<string>("");
    const [fullName, setFullName] = useState("");
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [isPasswordFocused, setIsPasswordFocused] = useState(false);
    const [isConfirmPasswordFocused, setIsConfirmPasswordFocused] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (selectedTenantId) return;
        if (currentTenantId) {
            setSelectedTenantId(currentTenantId);
        } else if (tenants.length > 0) {
            setSelectedTenantId(tenants[0].id);
        }
    }, [currentTenantId, tenants, selectedTenantId]);

    // Se recalcula en cada cambio del input, así la lista reacciona en tiempo real
    const allRequirementsMet = PASSWORD_REQUIREMENTS.every((req) => req.test(password));
    const passwordsMatch = password === confirmPassword;
    const confirmMismatch = confirmPassword.length > 0 && !passwordsMatch;
    const confirmRequirements = [
        { label: t("requirements.notEmpty"), met: password.length > 0 },
        { label: t("requirements.match"), met: confirmPassword.length > 0 && passwordsMatch },
    ];
    const canSubmit = allRequirementsMet && confirmPassword.length > 0 && passwordsMatch;

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();

        if (!canSubmit) {
            return;
        }

        const [firstName, ...restName] = fullName.trim().split(/\s+/);
        const lastName = restName.join(" ") || undefined;
        const targetTenantId = isCustomDomain
            ? getCurrentTenantId()
            : selectedTenantId || getCurrentTenantId();

        setIsLoading(true);
        setError(null);
        try {
            const response = await authService.register(
                {
                    email,
                    password,
                    firstName,
                    lastName,
                    phone: phone.trim() || undefined,
                },
                targetTenantId ?? undefined,
            );

            // Solo se aceptan rutas internas para evitar redirecciones a sitios externos
            const redirect = searchParams.get("redirect");
            const target = redirect && redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : "/";

            if (targetTenantId && targetTenantId !== getCurrentTenantId()) {
                switchTenantWithAuth(targetTenantId, response, target);
                return;
            }

            dispatch(
                setAuth({
                    accessToken: response.accessToken,
                    refreshToken: response.refreshToken,
                    user: response.user,
                }),
            );
            router.push(target);
        } catch (err) {
            setError(getApiErrorMessage(err, "No se pudo crear la cuenta. Inténtalo de nuevo."));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <section className={styles.section}>
            <div className={styles.container}>
                <div className={styles.fromWrapper}>
                    <h1 className={styles.title}>{t("register.title")}</h1>
                    <p className={styles.subtitle}>{t("register.subtitle")}</p>

                    <form className={styles.form} onSubmit={handleSubmit} noValidate>
                        {error && (
                            <div className={styles.error}>
                                <Info size={20} />
                                <span>{error}</span>
                            </div>
                        )}

                        {!isCustomDomain && tenants.length > 0 && (
                            <div className={styles.field}>
                                <label htmlFor="registerTenant">Tienda donde te registras</label>
                                <select
                                    id="registerTenant"
                                    className={styles.selectInput}
                                    value={selectedTenantId}
                                    onChange={(e) => setSelectedTenantId(e.target.value)}
                                    disabled={isLoading}
                                >
                                    {tenants.map((tenant) => (
                                        <option key={tenant.id} value={tenant.id}>
                                            {tenant.name} (/{tenant.slug})
                                        </option>
                                    ))}
                                </select>
                                <span className={styles.fieldHint}>
                                    Puedes registrarte con tu mismo correo en varias tiendas diferentes.
                                </span>
                            </div>
                        )}

                        <div className={styles.field}>
                            <label htmlFor="fullName">{t("register.fullName")}</label>
                            <input
                                type="text"
                                id="fullName"
                                value={fullName}
                                onChange={(e) => setFullName(e.target.value)}
                                placeholder={t("register.fullNamePlaceholder")}
                                required
                                disabled={isLoading}
                            />
                        </div>

                        <div className={styles.field}>
                            <label htmlFor="email">{t("email")}</label>
                            <input
                                type="email"
                                id="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder={t("emailPlaceholder")}
                                required
                                disabled={isLoading}
                            />
                        </div>

                        <div className={styles.field}>
                            <label htmlFor="phone">{t("register.phone")}</label>
                            <input
                                type="tel"
                                id="phone"
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                placeholder={t("register.phonePlaceholder")}
                                required
                                disabled={isLoading}
                            />
                        </div>

                        <div className={styles.field}>
                            <label htmlFor="password">{t("password")}</label>
                            <div className={styles.inputWrapper}>
                                <input
                                    type={showPassword ? "text" : "password"}
                                    id="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder={t("passwordPlaceholder")}
                                    required
                                    disabled={isLoading}
                                    onFocus={() => setIsPasswordFocused(true)}
                                    onBlur={() => setIsPasswordFocused(false)}
                                />
                                <button
                                    type="button"
                                    className={styles.toggleButton}
                                    onClick={() => setShowPassword(!showPassword)}
                                    aria-label={showPassword ? t("hidePassword") : t("showPassword")}
                                >
                                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                                </button>
                                {isPasswordFocused && (
                                    <ul className={styles.checklist}>
                                        {PASSWORD_REQUIREMENTS.map((req) => {
                                            const met = req.test(password);
                                            return (
                                                <li
                                                    key={req.key}
                                                    className={`${styles.checkItem} ${met ? styles.checkItemMet : ""}`}
                                                >
                                                    {met ? <Check size={14} strokeWidth={3} /> : <Circle size={10} />}
                                                    {t(`requirements.${req.key}`)}
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </div>
                        </div>

                        <div className={styles.field}>
                            <label htmlFor="confirmPassword">{t("confirmPassword")}</label>
                            <div className={styles.inputWrapper}>
                                <input
                                    type={showConfirmPassword ? "text" : "password"}
                                    id="confirmPassword"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    placeholder={t("confirmPasswordPlaceholder")}
                                    required
                                    disabled={isLoading}
                                    aria-invalid={confirmMismatch}
                                    onFocus={() => setIsConfirmPasswordFocused(true)}
                                    onBlur={() => setIsConfirmPasswordFocused(false)}
                                />
                                <button
                                    type="button"
                                    className={styles.toggleButton}
                                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                    aria-label={showConfirmPassword ? t("hidePassword") : t("showPassword")}
                                >
                                    {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                                </button>
                                {isConfirmPasswordFocused && (
                                    <ul className={styles.checklist}>
                                        {confirmRequirements.map((req) => (
                                            <li
                                                key={req.label}
                                                className={`${styles.checkItem} ${req.met ? styles.checkItemMet : ""}`}
                                            >
                                                {req.met ? <Check size={14} strokeWidth={3} /> : <Circle size={10} />}
                                                {req.label}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                            {confirmMismatch && (
                                <span className={styles.fieldError}>{t("passwordsDontMatch")}</span>
                            )}
                        </div>

                        <button type="submit" className={styles.submitButton} disabled={!canSubmit || isLoading}>
                            {isLoading ? t("register.submitting") : t("register.submit")}
                        </button>
                    </form>

                    <p className={styles.footerText}>
                        {t("register.haveAccount")}{" "}
                        <button
                            type="button"
                            className={styles.link}
                            onClick={() => router.push("/auth/login")}
                        >
                            {t("register.login")}
                        </button>
                    </p>
                </div>
            </div>
        </section>
    );
}
