"use client";

import { FormEvent, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { platformService } from "@/service/api/platform.service";
import { getApiErrorMessage } from "@/service/api/error.utils";
import styles from "./platform.module.scss";

// Contacto con la administración del SaaS → POST /api/v1/platform/contact → bandeja de soporte.
export function ContactForm() {
    const t = useTranslations("Contact");
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [message, setMessage] = useState("");
    // Honeypot: invisible para personas (fuera de pantalla y sin tab), los bots lo completan
    const [website, setWebsite] = useState("");
    const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
    const [error, setError] = useState<string | null>(null);

    const onSubmit = async (event: FormEvent) => {
        event.preventDefault();
        if (name.trim().length < 2) return setError(t("errors.name"));
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError(t("errors.email"));
        if (message.trim().length < 10) return setError(t("errors.message"));

        setStatus("sending");
        setError(null);
        try {
            await platformService.sendContact({ name: name.trim(), email: email.trim(), message: message.trim(), website });
            setStatus("sent");
        } catch (err) {
            setError(getApiErrorMessage(err, t("errors.send")));
            setStatus("idle");
        }
    };

    if (status === "sent") {
        return (
            <div className={styles.card} role="status">
                <CheckCircle2 size={36} aria-hidden />
                <h2>{t("sentTitle")}</h2>
                <p className={styles.muted}>{t("sentBody", { email })}</p>
            </div>
        );
    }

    const sending = status === "sending";
    return (
        <form className={styles.card} onSubmit={onSubmit} noValidate>
            <h2>{t("title")}</h2>
            <p className={styles.muted}>{t("intro")}</p>

            <label className={styles.field}>
                {t("name")}
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoComplete="name" disabled={sending} />
            </label>
            <label className={styles.field}>
                {t("email")}
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" disabled={sending} />
            </label>
            <label className={styles.field}>
                {t("message")}
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} maxLength={5000} disabled={sending} />
            </label>

            <input
                className={styles.honeypot}
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                name="website"
            />

            {error && <p className={styles.error}>{error}</p>}
            <button type="submit" className={styles.primary} disabled={sending}>
                {sending ? <Loader2 size={18} className={styles.spin} /> : t("submit")}
            </button>
        </form>
    );
}
