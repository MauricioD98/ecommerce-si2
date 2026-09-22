'use client'
import styles from "./auth-form.module.scss"
import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Circle, Eye, EyeOff, Info } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const PASSWORD_REQUIREMENTS = [
    { label: "Al menos 8 caracteres", test: (p: string) => p.length >= 8 },
    { label: "Una letra mayúscula", test: (p: string) => /[A-Z]/.test(p) },
    { label: "Una letra minúscula", test: (p: string) => /[a-z]/.test(p) },
    { label: "Un número", test: (p: string) => /\d/.test(p) },
    { label: "Un carácter especial (@$!%*?&)", test: (p: string) => /[@$!%*?&]/.test(p) },
];

export default function RegisterForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { register, error, isLoading } = useAuth();

    const [fullName, setFullName] = useState("");
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [isPasswordFocused, setIsPasswordFocused] = useState(false);
    const [isConfirmPasswordFocused, setIsConfirmPasswordFocused] = useState(false);

    // Se recalcula en cada cambio del input, así la lista reacciona en tiempo real
    const allRequirementsMet = PASSWORD_REQUIREMENTS.every((req) => req.test(password));
    const passwordsMatch = password === confirmPassword;
    const confirmMismatch = confirmPassword.length > 0 && !passwordsMatch;
    const confirmRequirements = [
        { label: "La contraseña no está vacía", met: password.length > 0 },
        { label: "Las contraseñas coinciden", met: confirmPassword.length > 0 && passwordsMatch },
    ];
    const canSubmit = allRequirementsMet && confirmPassword.length > 0 && passwordsMatch;

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();

        if (!canSubmit) {
            return;
        }

        // El backend recibe nombre y apellido por separado; el teléfono aún no tiene campo en la API
        const [firstName, ...restName] = fullName.trim().split(/\s+/);
        const lastName = restName.join(" ") || undefined;

        const success = await register({ email, password, firstName, lastName });
        if (!success) {
            return;
        }

        // Solo se aceptan rutas internas para evitar redirecciones a sitios externos
        const redirect = searchParams.get("redirect");
        const target = redirect && redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : "/";
        router.push(target);
    }

    return (
        <section className={styles.section}>
            {/* container */}
            <div className={styles.container}>
                {/*from */}
                <div className={styles.fromWrapper}>
                    <h1 className={styles.title}>Crea tu cuenta</h1>
                    <p className={styles.subtitle}>Regístrate para comenzar a comprar</p>

                    <form className={styles.form} onSubmit={handleSubmit} noValidate>
                        {error && (
                            <div className={styles.error}>
                                <Info size={20} />
                                <span>{error}</span>
                            </div>
                        )}

                        <div className={styles.field}>
                            <label htmlFor="fullName">Nombre y Apellido</label>
                            <input type="text" id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Ingresa tu nombre y apellido" required />
                        </div>

                        <div className={styles.field}>
                            <label htmlFor="email">Correo electrónico</label>
                            <input type="email" id="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@ejemplo.com" required />
                        </div>

                        <div className={styles.field}>
                            <label htmlFor="phone">Teléfono celular</label>
                            <input type="tel" id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Ingresa tu teléfono celular" required />
                        </div>

                        <div className={styles.field}>
                            <label htmlFor="password">Contraseña</label>
                            <div className={styles.inputWrapper}>
                                <input type={showPassword ? "text" : "password"} id="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Ingresa tu contraseña" required onFocus={() => setIsPasswordFocused(true)} onBlur={() => setIsPasswordFocused(false)} />
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
                                <input type={showConfirmPassword ? "text" : "password"} id="confirmPassword" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Repite tu contraseña" required aria-invalid={confirmMismatch} onFocus={() => setIsConfirmPasswordFocused(true)} onBlur={() => setIsConfirmPasswordFocused(false)} />
                                <button
                                    type="button"
                                    className={styles.toggleButton}
                                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                    aria-label={showConfirmPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                                >
                                    {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                                </button>
                                {isConfirmPasswordFocused && (
                                    <ul className={styles.checklist}>
                                        {confirmRequirements.map((req) => (
                                            <li key={req.label} className={`${styles.checkItem} ${req.met ? styles.checkItemMet : ""}`}>
                                                {req.met ? <Check size={14} strokeWidth={3} /> : <Circle size={10} />}
                                                {req.label}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                            {confirmMismatch && <span className={styles.fieldError}>Las contraseñas no coinciden</span>}
                        </div>

                        <button type="submit" className={styles.submitButton} disabled={!canSubmit || isLoading}>
                            {isLoading ? "Creando cuenta..." : "Registrarse"}
                        </button>
                    </form>

                    <p className={styles.footerText}>
                        ¿Ya tienes una cuenta?{" "}
                        <button type="button" className={styles.link} onClick={() => router.push("/auth/login")}>
                            Iniciar sesión
                        </button>
                    </p>

                </div>
            </div>

        </section>
    );
}
