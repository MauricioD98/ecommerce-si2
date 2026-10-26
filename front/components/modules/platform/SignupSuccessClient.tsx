"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { platformService, type CheckoutStatus } from "@/service/api/platform.service";
import styles from "./platform.module.scss";

const POLL_MS = 3000;
// Crear el schema y migrar suele tardar segundos; si pasa esto, se deja de consultar y se avisa
// que llegará por email (el webhook sigue trabajando aunque el usuario cierre la página).
const MAX_WAIT_MS = 3 * 60_000;

// Vuelta de Stripe Checkout (/planes/exito?session_id=...). El pago ya está hecho; la tienda la crea
// el webhook en segundo plano, así que acá se consulta el estado hasta que esté lista.
export default function SignupSuccessClient() {
    const t = useTranslations("Signup");
    const sessionId = useSearchParams().get("session_id");
    const [status, setStatus] = useState<CheckoutStatus | null>(null);
    const [timedOut, setTimedOut] = useState(false);

    useEffect(() => {
        if (!sessionId) return;
        const started = Date.now();
        let timer: ReturnType<typeof setTimeout>;
        let cancelled = false;

        const poll = async () => {
            try {
                const current = await platformService.getCheckoutStatus(sessionId);
                if (cancelled) return;
                setStatus(current);
                if (current.status === "COMPLETED" || current.status === "FAILED" || current.status === "EXPIRED") return;
            } catch {
                // El webhook puede llegar unos segundos después de la redirección: se reintenta
            }
            if (Date.now() - started > MAX_WAIT_MS) return setTimedOut(true);
            timer = setTimeout(poll, POLL_MS);
        };
        void poll();
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [sessionId]);

    if (!sessionId) {
        return (
            <div className={styles.card}>
                <AlertTriangle size={36} aria-hidden />
                <h1>{t("notFoundTitle")}</h1>
                <p className={styles.muted}>{t("notFoundBody")}</p>
            </div>
        );
    }

    if (status?.status === "COMPLETED" && status.loginUrl) {
        return (
            <div className={styles.card} role="status">
                <CheckCircle2 size={40} aria-hidden />
                <h1>{t("readyTitle", { tenant: status.tenantName })}</h1>
                <p className={styles.muted}>{t("readyBody")}</p>
                {/* <a> y no <Link>: el login vive en el contexto de la tienda (?tenant=), recarga completa */}
                <a className={styles.primary} href={status.loginUrl}>
                    {t("goToPanel")}
                </a>
            </div>
        );
    }

    if (status?.status === "FAILED" || timedOut) {
        return (
            <div className={styles.card}>
                <AlertTriangle size={36} aria-hidden />
                <h1>{t("pendingTitle")}</h1>
                <p className={styles.muted}>{t("pendingBody")}</p>
            </div>
        );
    }

    return (
        <div className={styles.card} role="status" aria-live="polite">
            <Loader2 size={36} className={styles.spin} aria-hidden />
            <h1>{t("creatingTitle")}</h1>
            <p className={styles.muted}>{t("creatingBody", { tenant: status?.tenantName ?? t("yourStore") })}</p>
        </div>
    );
}
