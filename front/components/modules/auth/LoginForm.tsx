'use client';

import styles from "./auth-form.module.scss";
import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import { ChevronRight, Eye, EyeOff, Info, Loader2, Store } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAppDispatch } from "@/store";
import { setAuth } from "@/store/slices/authSlices";
import { authService, TenantMatchOption } from "@/service/api/auth.service";
import { getApiErrorMessage } from "@/service/api/error.utils";
import { usePublicTenants } from "@/hooks/usePublicTenants";
import { canAccessAdmin } from "@/utils/permissions";
import { getCurrentTenantId, switchTenantWithAuth } from "@/utils/tenant";
import { AutoResponse } from "@/types/auth.types";

export default function LoginForm() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const dispatch = useAppDispatch();
    const t = useTranslations("Auth");
    const { tenants, currentTenantId, isCustomDomain } = usePublicTenants();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [selectedTenantId, setSelectedTenantId] = useState<string>("auto");
    const [matchedTenants, setMatchedTenants] = useState<TenantMatchOption[] | null>(null);
    const [showPassword, setShowPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const resolveTargetUrl = (auth: AutoResponse): string => {
        const rawRedirect = searchParams.get("redirect");
        const validRedirect =
            rawRedirect && rawRedirect.startsWith("/") && !rawRedirect.startsWith("//")
                ? rawRedirect
                : null;
        if (validRedirect) {
            if (validRedirect.startsWith("/admin") && !canAccessAdmin(auth.user)) {
                return "/";
            }
            return validRedirect;
        }
        return canAccessAdmin(auth.user) ? "/admin" : "/";
    };

    const completeLogin = (targetTenantId: string | null, auth: AutoResponse) => {
        const target = resolveTargetUrl(auth);
        const activeTenantId = getCurrentTenantId();

        if (targetTenantId && targetTenantId !== activeTenantId) {
            switchTenantWithAuth(targetTenantId, auth, target);
            return;
        }

        dispatch(
            setAuth({
                accessToken: auth.accessToken,
                refreshToken: auth.refreshToken,
                user: auth.user,
            }),
        );
        router.push(target);
    };

    const formatLoginError = (err: unknown): string =>
        axios.isAxiosError(err) && err.response?.status === 401
            ? "Correo o contraseña incorrectos."
            : getApiErrorMessage(err, "Error al iniciar sesión. Inténtalo de nuevo.");

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);

        try {
            if (isCustomDomain) {
                const auth = await authService.login({ email, password });
                completeLogin(getCurrentTenantId(), auth);
                return;
            }

            const urlTenant = searchParams.get("tenant") ?? undefined;
            const response = await authService.tenantLogin({
                email,
                password,
                tenantId: selectedTenantId === "auto" ? undefined : selectedTenantId,
                preferredTenantId: urlTenant || currentTenantId || undefined,
            });

            if (response.isPlatformAdmin) {
                try {
                    sessionStorage.setItem(
                        "sf_platform_session",
                        JSON.stringify({
                            token: response.accessToken,
                            email: response.admin.email,
                        }),
                    );
                } catch {
                    // sessionStorage no disponible
                }
                window.location.href = response.redirectUrl || "/plataforma";
                return;
            }

            if (response.requiresTenantSelection) {
                setMatchedTenants(response.tenants);
                return;
            }

            completeLogin(response.tenant.id, response.auth);
        } catch (err) {
            setError(formatLoginError(err));
        } finally {
            setIsLoading(false);
        }
    };

    const handlePickMatchedTenant = async (tenantId: string) => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await authService.tenantLogin({
                email,
                password,
                tenantId,
            });
            if (!response.requiresTenantSelection && !response.isPlatformAdmin) {
                completeLogin(response.tenant.id, response.auth);
            }
        } catch (err) {
            setError(formatLoginError(err));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <section className={styles.section}>
            <div className={styles.container}>
                <div className={styles.fromWrapper}>
                    {matchedTenants ? (
                        <>
                            <h1 className={styles.title}>Elige tu tienda</h1>
                            <p className={styles.subtitle}>
                                Tu correo está registrado en varias tiendas. Selecciona a cuál deseas ingresar:
                            </p>

                            {error && (
                                <div className={styles.error}>
                                    <Info size={20} />
                                    <span>{error}</span>
                                </div>
                            )}

                            <div className={styles.tenantList}>
                                {matchedTenants.map((option) => (
                                    <button
                                        key={option.id}
                                        type="button"
                                        className={styles.tenantOption}
                                        onClick={() => handlePickMatchedTenant(option.id)}
                                        disabled={isLoading}
                                    >
                                        <span className={styles.tenantOptionLeft}>
                                            <Store size={20} />
                                            <span className={styles.tenantOptionInfo}>
                                                <span className={styles.tenantOptionName}>{option.name}</span>
                                                <span className={styles.tenantOptionMeta}>/{option.slug}</span>
                                            </span>
                                        </span>
                                        <span className={styles.tenantOptionLeft}>
                                            <span className={styles.roleBadge}>{option.role}</span>
                                            <ChevronRight size={18} />
                                        </span>
                                    </button>
                                ))}
                            </div>

                            <button
                                type="button"
                                className={styles.linkButton}
                                onClick={() => {
                                    setMatchedTenants(null);
                                    setError(null);
                                }}
                                disabled={isLoading}
                            >
                                ← Volver y cambiar correo
                            </button>
                        </>
                    ) : (
                        <>
                            <h1 className={styles.title}>{t("login.title")}</h1>
                            <p className={styles.subtitle}>{t("login.subtitle")}</p>

                            <form className={styles.form} onSubmit={handleSubmit}>
                                {error && (
                                    <div className={styles.error}>
                                        <Info size={20} />
                                        <span>{error ?? t("genericError")}</span>
                                    </div>
                                )}

                                {!isCustomDomain && tenants.length > 0 && (
                                    <div className={styles.field}>
                                        <label htmlFor="loginTenant">Tienda</label>
                                        <select
                                            id="loginTenant"
                                            className={styles.selectInput}
                                            value={selectedTenantId}
                                            onChange={(e) => setSelectedTenantId(e.target.value)}
                                            disabled={isLoading}
                                        >
                                            <option value="auto">
                                                Automático (detectar según mi correo)
                                            </option>
                                            {tenants.map((tenant) => (
                                                <option key={tenant.id} value={tenant.id}>
                                                    {tenant.name} (/{tenant.slug})
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                <div className={styles.field}>
                                    <label htmlFor="email">{t("email")}</label>
                                    <input
                                        type="email"
                                        id="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder={t("emailPlaceholder")}
                                        autoComplete="email"
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
                                            autoComplete="current-password"
                                            required
                                            disabled={isLoading}
                                        />
                                        <button
                                            type="button"
                                            className={styles.toggleButton}
                                            onClick={() => setShowPassword(!showPassword)}
                                            aria-label={showPassword ? t("hidePassword") : t("showPassword")}
                                            disabled={isLoading}
                                        >
                                            {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                                        </button>
                                    </div>
                                    <button
                                        type="button"
                                        className={styles.forgotLink}
                                        onClick={() => router.push("/auth/forgot-password")}
                                    >
                                        {t("login.forgot")}
                                    </button>
                                </div>

                                <button type="submit" className={styles.submitButton} disabled={isLoading}>
                                    {isLoading ? (
                                        <>
                                            <Loader2 className={styles.spinner} />
                                            {t("login.submitting")}
                                        </>
                                    ) : (
                                        t("login.submit")
                                    )}
                                </button>
                            </form>

                            <p className={styles.footerText}>
                                {t("login.noAccount")}{" "}
                                <button
                                    type="button"
                                    className={styles.link}
                                    onClick={() => router.push("/auth/register")}
                                >
                                    {t("login.createAccount")}
                                </button>
                            </p>
                        </>
                    )}
                </div>
            </div>
        </section>
    );
}
