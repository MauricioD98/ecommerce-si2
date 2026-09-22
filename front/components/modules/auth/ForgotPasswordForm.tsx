'use client'
import styles from "./auth-form.module.scss"
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Circle, Eye, EyeOff, Info } from "lucide-react";
import { authService } from "@/service/api/auth.service";
import { getApiErrorMessage } from "@/service/api/error.utils";

const OTP_LENGTH = 6;

const PASSWORD_REQUIREMENTS = [
    { label: "Al menos 8 caracteres", test: (p: string) => p.length >= 8 },
    { label: "Una letra mayúscula", test: (p: string) => /[A-Z]/.test(p) },
    { label: "Una letra minúscula", test: (p: string) => /[a-z]/.test(p) },
    { label: "Un número", test: (p: string) => /\d/.test(p) },
    { label: "Un carácter especial (@$!%*?&)", test: (p: string) => /[@$!%*?&]/.test(p) },
];

// Recuperación de contraseña en 3 pasos: 1) correo -> 2) código de 6 dígitos -> 3) nueva contraseña
export default function ForgotPasswordForm() {
    const router = useRouter();

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
            setError(getApiErrorMessage(err, "No se pudo enviar el código. Inténtalo de nuevo."));
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
            setInfo("Te enviamos un nuevo código.");
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
            setOtpError(getApiErrorMessage(err, "Código incorrecto o vencido"));
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
            const message = getApiErrorMessage(err, "No se pudo actualizar la contraseña. Inténtalo de nuevo.");
            if (/código no es válido|venció/i.test(message)) {
                // El código expiró o se anuló mientras se escribía la contraseña: hay que ingresarlo de nuevo
                setOtp("");
                setOtpError("El código venció o ya no es válido. Solicita uno nuevo.");
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

    const title = done || step === 1 ? "Recuperar contraseña" : step === 2 ? "Ingresa tu código" : "Nueva contraseña";

    return (
        <section className={styles.section}>
            {done && (
                <div className={styles.toast} role="status">
                    <Check size={18} strokeWidth={3} /> Contraseña actualizada correctamente
                </div>
            )}

            <div className={styles.container}>
                <div className={styles.fromWrapper}>
                    <h1 className={styles.title}>{title}</h1>

                    {done ? (
                        <>
                            <div className={styles.successMessage}>
                                Tu contraseña se actualizó correctamente. Te llevaremos a iniciar sesión...
                            </div>
                            <button type="button" className={styles.submitButton} onClick={() => router.push("/auth/login")}>
                                Ir a iniciar sesión
                            </button>
                        </>
                    ) : step === 1 ? (
                        <>
                            <p className={styles.description}>
                                Ingresa tu correo electrónico y te enviaremos un código de 6 dígitos.
                            </p>
                            <form className={styles.form} onSubmit={handleEmailSubmit}>
                                {errorBox}
                                <div className={styles.field}>
                                    <label htmlFor="email">Correo electrónico</label>
                                    <input type="email" id="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@ejemplo.com" required autoComplete="email" />
                                </div>
                                <button type="submit" className={styles.submitButton} disabled={isLoading}>
                                    {isLoading ? "Enviando..." : "Enviar código"}
                                </button>
                            </form>
                        </>
                    ) : step === 2 ? (
                        <>
                            <p className={styles.description}>
                                Hemos enviado un código de 6 dígitos a <strong>{email}</strong>. Vence en 10 minutos.
                            </p>
                            <form className={styles.form} onSubmit={handleOtpSubmit}>
                                {errorBox}
                                {info && <div className={styles.successMessage}>{info}</div>}
                                <div className={styles.field}>
                                    <label htmlFor="otp">Código de verificación</label>
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
                                    {isLoading ? "Validando..." : "Validar código"}
                                </button>
                                <button type="button" className={styles.linkButton} onClick={handleResend} disabled={isLoading}>
                                    ¿No recibiste el código? Volver a enviar
                                </button>
                                <button type="button" className={styles.linkButton} onClick={() => { setError(null); setInfo(null); setOtpError(null); setStep(1); }}>
                                    Cambiar correo
                                </button>
                            </form>
                        </>
                    ) : (
                        <>
                            <p className={styles.description}>Elige una contraseña nueva para tu cuenta.</p>
                            <form className={styles.form} onSubmit={handleResetSubmit} noValidate>
                                {errorBox}

                                <div className={styles.field}>
                                    <label htmlFor="password">Nueva contraseña</label>
                                    <div className={styles.inputWrapper}>
                                        <input type={showPassword ? "text" : "password"} id="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Ingresa tu nueva contraseña" required autoComplete="new-password" onFocus={() => setIsPasswordFocused(true)} onBlur={() => setIsPasswordFocused(false)} />
                                        <button
                                            type="button"
                                            className={styles.toggleButton}
                                            onClick={() => setShowPassword(!showPassword)}
                                            aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                                        >
                                            {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                                        </button>
                                        {isPasswordFocused && (
                                            <ul className={styles.checklist}>
                                                {PASSWORD_REQUIREMENTS.map((req) => {
                                                    const met = req.test(password);
                                                    return (
                                                        <li key={req.label} className={`${styles.checkItem} ${met ? styles.checkItemMet : ""}`}>
                                                            {met ? <Check size={14} strokeWidth={3} /> : <Circle size={10} />}
                                                            {req.label}
                                                        </li>
                                                    );
                                                })}
                                            </ul>
                                        )}
                                    </div>
                                </div>

                                <div className={styles.field}>
                                    <label htmlFor="confirmPassword">Confirmar contraseña</label>
                                    <div className={styles.inputWrapper}>
                                        <input type={showConfirmPassword ? "text" : "password"} id="confirmPassword" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Repite tu contraseña" required autoComplete="new-password" aria-invalid={confirmMismatch} />
                                        <button
                                            type="button"
                                            className={styles.toggleButton}
                                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                            aria-label={showConfirmPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                                        >
                                            {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                                        </button>
                                    </div>
                                    {confirmMismatch && <span className={styles.fieldError}>Las contraseñas no coinciden</span>}
                                </div>

                                <button type="submit" className={styles.submitButton} disabled={!canSubmitPassword || isLoading}>
                                    {isLoading ? "Guardando..." : "Actualizar contraseña"}
                                </button>
                            </form>
                        </>
                    )}

                    {!done && (
                        <button type="button" className={styles.linkButton} onClick={() => router.push("/auth/login")}>
                            Volver a iniciar sesión
                        </button>
                    )}
                </div>
            </div>
        </section>
    );
}
