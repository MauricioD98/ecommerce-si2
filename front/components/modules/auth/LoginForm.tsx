'use client';

import styles from "./auth-form.module.scss";
import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import { ChevronRight, Eye, EyeOff, Info, Loader2, ShieldCheck, Store } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAppDispatch } from "@/store";
import { setAuth } from "@/store/slices/authSlices";
import { authService } from "@/service/api/auth.service";
import { getApiErrorMessage } from "@/service/api/error.utils";
import { usePublicTenants } from "@/hooks/usePublicTenants";
import { canAccessAdmin } from "@/utils/permissions";
import { getCurrentTenantId, switchTenantWithAuth } from "@/utils/tenant";
import { AutoResponse } from "@/types/auth.types";
import { countPendingProfileChanges } from "@/utils/offlineProfile";

// La tienda se elige ANTES de pedir las credenciales: dominio propio (cookie de proxy.ts), tienda
// activa del navegador (?tenant=, la recordada o NEXT_PUBLIC_TENANT_ID) o el selector de abajo. El
// backend solo consulta el correo en esa tienda. Los administradores de NovaSoft entran por /plataforma.
export default function LoginForm() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const dispatch = useAppDispatch();
    const t = useTranslations("Auth");
    const { tenants, currentTenantId, isCustomDomain, isLoading: tenantsLoading } = usePublicTenants();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    // null = el usuario no eligió: vale la tienda activa del navegador. "" = pidió cambiarla
    const [pickedTenantId, setPickedTenantId] = useState<string | null>(null);
    const [showPassword, setShowPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Cambios de perfil guardados sin conexión en este dispositivo (de esta tienda). No se dice de quién: solo
    // se avisa que se envían cuando entra la misma cuenta
    const [pendingProfile, setPendingProfile] = useState(false);
    useEffect(() => {
        let active = true;
        countPendingProfileChanges().then((count) => active && setPendingProfile(count > 0));
        return () => {
            active = false;
        };
    }, []);

    // Sin tienda ("") se muestra el selector en lugar del formulario
    const selectedTenantId = pickedTenantId ?? currentTenantId ?? "";
    const selectedTenant = tenants.find((tenant) => tenant.id === selectedTenantId) ?? null;

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

    // El backend responde el mismo 401 para correo inexistente, contraseña incorrecta, cuenta
    // bloqueada o tienda no disponible: el mensaje tampoco los distingue
    const formatLoginError = (err: unknown): string =>
        axios.isAxiosError(err) && err.response?.status === 401
            ? t("login.invalidCredentials")
            : getApiErrorMessage(err, t("genericError"));

    const pickTenant = (tenantId: string) => {
        setPickedTenantId(tenantId);
        setError(null);
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);

        try {
            if (isCustomDomain) {
                // Dominio propio verificado: proxy.ts fija la tienda en x-tenant-id
                const auth = await authService.login({ email, password });
                completeLogin(getCurrentTenantId(), auth);
                return;
            }

            const response = await authService.tenantLogin({ email, password, tenantId: selectedTenantId });
            completeLogin(response.tenant.id, response.auth);
        } catch (err) {
            setError(formatLoginError(err));
        } finally {
            setIsLoading(false);
        }
    };

    const platformAdminLink = !isCustomDomain && (
        <p className={styles.footerText}>
            <ShieldCheck size={16} aria-hidden="true" /> {t("login.platformAdminPrompt")}{" "}
            <button type="button" className={styles.link} onClick={() => router.push("/plataforma")}>
                {t("login.platformAdminLink")}
            </button>
        </p>
    );

    const needsStore = !isCustomDomain && !selectedTenantId;

    return (
        <section className={styles.section}>
            <div className={styles.container}>
                <div className={styles.fromWrapper}>
                    {needsStore ? (
                        <>
                            <h1 className={styles.title}>{t("login.storeStepTitle")}</h1>
                            <p className={styles.subtitle}>{t("login.storeStepSubtitle")}</p>

                            {tenantsLoading ? (
                                <Loader2 className={styles.spinner} />
                            ) : tenants.length === 0 ? (
                                <div className={styles.error}>
                                    <Info size={20} />
                                    <span>{t("login.noStores")}</span>
                                </div>
                            ) : (
                                <div className={styles.tenantList}>
                                    {tenants.map((tenant) => (
                                        <button
                                            key={tenant.id}
                                            type="button"
                                            className={styles.tenantOption}
                                            onClick={() => pickTenant(tenant.id)}
                                        >
                                            <span className={styles.tenantOptionLeft}>
                                                <Store size={20} />
                                                <span className={styles.tenantOptionInfo}>
                                                    <span className={styles.tenantOptionName}>{tenant.name}</span>
                                                    <span className={styles.tenantOptionMeta}>/{tenant.slug}</span>
                                                </span>
                                            </span>
                                            <ChevronRight size={18} />
                                        </button>
                                    ))}
                                </div>
                            )}

                            {platformAdminLink}
                        </>
                    ) : (
                        <>
                            <h1 className={styles.title}>{t("login.title")}</h1>
                            <p className={styles.subtitle}>{t("login.subtitle")}</p>

                            {pendingProfile && (
                                <div className={styles.notice} role="status">
                                    <Info size={20} />
                                    <span>{t("login.pendingProfileChanges")}</span>
                                </div>
                            )}

                            <form className={styles.form} onSubmit={handleSubmit}>
                                {error && (
                                    <div className={styles.error}>
                                        <Info size={20} />
                                        <span>{error ?? t("genericError")}</span>
                                    </div>
                                )}

                                {!isCustomDomain && (
                                    <div className={styles.field}>
                                        <label id="loginTenantLabel">{t("login.storeLabel")}</label>
                                        <div className={styles.tenantOption} role="group" aria-labelledby="loginTenantLabel">
                                            <span className={styles.tenantOptionLeft}>
                                                <Store size={20} />
                                                <span className={styles.tenantOptionInfo}>
                                                    <span className={styles.tenantOptionName}>
                                                        {selectedTenant?.name ?? t("login.currentStore")}
                                                    </span>
                                                    {selectedTenant && (
                                                        <span className={styles.tenantOptionMeta}>/{selectedTenant.slug}</span>
                                                    )}
                                                </span>
                                            </span>
                                            {tenants.length > 0 && (
                                                <button
                                                    type="button"
                                                    className={styles.linkButton}
                                                    onClick={() => pickTenant("")}
                                                    disabled={isLoading}
                                                >
                                                    {t("login.changeStore")}
                                                </button>
                                            )}
                                        </div>
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

                            {platformAdminLink}
                        </>
                    )}
                </div>
            </div>
        </section>
    );
}
