'use client'
import styles from "./auth-form.module.scss"
import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Info, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/hooks/useAuth";

export default function LoginForm() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const t = useTranslations("Auth");

    const handleSubmit =async (e: FormEvent) => {
        e.preventDefault();

        const sucess = await login({ email, password });

        if (sucess) {
            const redirect = searchParams.get("redirect");
            router.push(redirect || "/")
        }
    }
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const { login, error, isLoading } = useAuth()

    return (
        <section className={styles.section}>
            {/* container */}
            <div className={styles.container}>
                {/*from */}
                <div className={styles.fromWrapper}>
                    <h1 className={styles.title}>{t("login.title")}</h1>
                    <p className={styles.subtitle}>{t("login.subtitle")}</p>

                    <form className={styles.form} onSubmit={handleSubmit}>
                        {
                            error && (
                                <div className={styles.error}>
                                    <Info size={20} />
                                    <span>{error ?? t("genericError")}</span>

                                </div>
                            )}

                        <div className={styles.field}>
                            <label htmlFor="email">{t("email")}</label>
                            <input type="email" id="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("emailPlaceholder")} autoComplete="off" required disabled={isLoading} />

                        </div>


                        <div className={styles.field}>
                            <label htmlFor="password">{t("password")}</label>
                            <div className={styles.inputWrapper}>
                                <input type={showPassword ? "text" : "password"} id="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("passwordPlaceholder")} autoComplete="new-password" required disabled={isLoading} />
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
                            <button type="button" className={styles.forgotLink} onClick={() => router.push("/auth/forgot-password")}>
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
                            )
                            }

                        </button>
                    </form>

                    <p className={styles.footerText}>
                        {t("login.noAccount")}{" "}
                        <button type="button" className={styles.link} onClick={() => router.push("/auth/register")}>
                            {t("login.createAccount")}
                        </button>
                    </p>

                </div>
            </div>

        </section>
    );
}