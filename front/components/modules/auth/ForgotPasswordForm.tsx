'use client'
import styles from "./auth-form.module.scss"
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Circle, Eye, EyeOff, Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { authService } from "@/service/api/auth.service";
import { getApiErrorMessage } from "@/service/api/error.utils";

const OTP_LENGTH = 6;

// key: Auth.requirements.<key> en messages/<idioma>.json
const PASSWORD_REQUIREMENTS = [
    { key: "minLength", test: (p: string) => p.length >= 8 },
    { key: "uppercase", test: (p: string) => /[A-Z]/.test(p) },
    { key: "lowercase", test: (p: string) => /[a-z]/.test(p) },
    { key: "number", test: (p: string) => /\d/.test(p) },
    { key: "special", test: (p: string) => /[@$!%*?&]/.test(p) },
] as const;

// Recuperación de contraseña en 3 pasos: 1) correo -> 2) código de 6 dígitos -> 3) nueva contraseña
export default function ForgotPasswordForm() {
    const router = useRouter();
    const t = useTranslations("Auth");

    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [email, setEmail] = useState("");
    const [otp, setOtp] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [isPasswordFocused, setIsPasswordFocused] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [otpError, setOtpError] = useState<string | null>(null);
    const [info, setInfo] = useState<string | null>(null);
    const [done, setDone] = useState(false);

    const allRequirementsMet = PASSWORD_REQUIREMENTS.every((req) => req.test(password));
    const passwordsMatch = password === confirmPassword;
    const confirmMismatch = confirmPassword.length > 0 && !passwordsMatch;
    const canSubmitPassword = allRequirementsMet && confirmPassword.length > 0 && passwordsMatch;

    const requestCode = async () => {
        setIsLoading(true);
        setError(null);
        setOtpError(null);
        setInfo(null);
        try {
            await authService.forgotPassword(email);
            return true;
        } catch (err) {
            setError(getApiErrorMessage(err, t("forgot.sendFailed")));
            return false;
        } finally {
            setIsLoading(false);
        }
    };

    // Paso 1 -> 2
    const handleEmailSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (await requestCode()) {
            setOtp("");
            setStep(2);
        }
    };

    const handleResend = async () => {
        if (await requestCode()) {
            setOtp("");
            setInfo(t("forgot.codeResent"));
        }
    };

    // Paso 2 -> 3: solo avanza si el servidor confirma que el código es correcto y no venció
    const handleOtpSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (otp.length !== OTP_LENGTH) return;

        setIsLoading(true);
        setOtpError(null);
        setError(null);
        setInfo(null);
        try {
            await authService.verifyOtp(email, otp);
            setStep(3);
        } catch (err) {
            setOtpError(getApiErrorMessage(err, t("forgot.invalidCode")));
        } finally {
            setIsLoading(false);
        }
    };

    // Paso 3: envía email + código + nueva contraseña
    const handleResetSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!canSubmitPassword) return;

        setIsLoading(true);
        setError(null);
        try {
            await authService.resetPassword(email, otp, password);
            setDone(true);
            // Se deja ver el aviso un momento y se sale del formulario hacia el login
            setTimeout(() => router.push("/auth/login"), 1800);
        } catch (err) {
            const message = getApiErrorMessage(err, t("forgot.updateFailed"));
            if (/código no es válido|venció/i.test(message)) {
                // El código expiró o se anuló mientras se escribía la contraseña: hay que ingresarlo de nuevo
                setOtp("");
                setOtpError(t("forgot.codeExpired"));
                setStep(2);
            } else {
                // Contraseña débil u otro error: se queda en el paso 3 mostrando el mensaje de la API
                setError(message);
            }
        } finally {
            setIsLoading(false);
        }
    };

    const errorBox = error && (
        <div className={styles.error}>
            <Info size={20} />
            <span>{error}</span>
        </div>
    );

    const title = done || step === 1 ? t("forgot.titleEmail") : step === 2 ? t("forgot.titleCode") : t("forgot.titlePassword");

    return (
        <section className={styles.section}>
            {done && (
                <div className={styles.toast} role="status">
                    <Check size={18} strokeWidth={3} /> {t("forgot.updatedToast")}
                </div>
            )}

            <div className={styles.container}>
                <div className={styles.fromWrapper}>
                    <h1 className={styles.title}>{title}</h1>

                    {done ? (
                        <>
                            <div className={styles.successMessage}>
                                {t("forgot.updatedMessage")}
                            </div>
                            <button type="button" className={styles.submitButton} onClick={() => router.push("/auth/login")}>
                                {t("forgot.goToLogin")}
                            </button>
                        </>
                    ) : step === 1 ? (
                        <>
                            <p className={styles.description}>
                                {t("forgot.emailIntro")}
                            </p>
                            <form className={styles.form} onSubmit={handleEmailSubmit}>
                                {errorBox}
                                <div className={styles.field}>
                                    <label htmlFor="email">{t("email")}</label>
                                    <input type="email" id="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("emailPlaceholder")} required autoComplete="email" />
                                </div>
                                <button type="submit" className={styles.submitButton} disabled={isLoading}>
                                    {isLoading ? t("forgot.sending") : t("forgot.sendCode")}
                                </button>
                            </form>
                        </>
                    ) : step === 2 ? (
                        <>
                            <p className={styles.description}>
                                {t.rich("forgot.codeIntro", { email, strong: (chunks) => <strong>{chunks}</strong> })}
                            </p>
                            <form className={styles.form} onSubmit={handleOtpSubmit}>
                                {errorBox}
                                {info && <div className={styles.successMessage}>{info}</div>}
                                <div className={styles.field}>
                                    <label htmlFor="otp">{t("forgot.codeLabel")}</label>
                                    <input
                                        id="otp"
                                        className={styles.otpInput}
                                        type="text"
                                        inputMode="numeric"
                                        autoComplete="one-time-code"
                                        maxLength={OTP_LENGTH}
                                        value={otp}
                                        onChange={(e) => {
                                            setOtp(e.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH));
                                            setOtpError(null);
                                        }}
                                        aria-invalid={!!otpError}
                                        placeholder="000000"
                                        autoFocus
                                    />
                                    {otpError && <span className={styles.fieldError} role="alert">{otpError}</span>}
                                </div>
                                <button type="submit" className={styles.submitButton} disabled={otp.length !== OTP_LENGTH || isLoading}>
                                    {isLoading ? t("forgot.validating") : t("forgot.validate")}
                                </button>
                                <button type="button" className={styles.linkButton} onClick={handleResend} disabled={isLoading}>
                                    {t("forgot.resend")}
                                </button>
                                <button type="button" className={styles.linkButton} onClick={() => { setError(null); setInfo(null); setOtpError(null); setStep(1); }}>
                                    {t("forgot.changeEmail")}
                                </button>
                            </form>
                        </>
                    ) : (
                        <>
                            <p className={styles.description}>{t("forgot.passwordIntro")}</p>
                            <form className={styles.form} onSubmit={handleResetSubmit} noValidate>
                                {errorBox}

                                <div className={styles.field}>
                                    <label htmlFor="password">{t("forgot.newPassword")}</label>
                                    <div className={styles.inputWrapper}>
                                        <input type={showPassword ? "text" : "password"} id="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("forgot.newPasswordPlaceholder")} required autoComplete="new-password" onFocus={() => setIsPasswordFocused(true)} onBlur={() => setIsPasswordFocused(false)} />
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
                                                        <li key={req.key} className={`${styles.checkItem} ${met ? styles.checkItemMet : ""}`}>
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
                                        <input type={showConfirmPassword ? "text" : "password"} id="confirmPassword" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder={t("confirmPasswordPlaceholder")} required autoComplete="new-password" aria-invalid={confirmMismatch} />
                                        <button
                                            type="button"
                                            className={styles.toggleButton}
                                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                            aria-label={showConfirmPassword ? t("hidePassword") : t("showPassword")}
                                        >
                                            {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                                        </button>
                                    </div>
                                    {confirmMismatch && <span className={styles.fieldError}>{t("passwordsDontMatch")}</span>}
                                </div>

                                <button type="submit" className={styles.submitButton} disabled={!canSubmitPassword || isLoading}>
                                    {isLoading ? t("forgot.saving") : t("forgot.update")}
                                </button>
                            </form>
                        </>
                    )}

                    {!done && (
                        <button type="button" className={styles.linkButton} onClick={() => router.push("/auth/login")}>
                            {t("backToLogin")}
                        </button>
                    )}
                </div>
            </div>
        </section>
    );
}
