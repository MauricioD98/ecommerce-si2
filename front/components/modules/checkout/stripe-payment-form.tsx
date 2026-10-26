import React, { useEffect, useState } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, StripeElementsOptions } from "@stripe/stripe-js";
import styles from "./stripe-payment-form.module.scss"; // Ajusta ruta si es necesario
import { Loader2 } from "lucide-react"; // Importando Loader2 correctamente
import { useLocale, useTranslations } from "next-intl";

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
if (!publishableKey) {
    console.error('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY no está configurada: Stripe no puede inicializarse.');
}
// null (en vez de lanzar con "!") cuando falta la llave: así el provider puede mostrar un error controlado
const stripePromise = publishableKey ? loadStripe(publishableKey) : null;

export function StripePaymentProvider({
    clientSecret,
    children,
    amount,
    onSuccess,
    onError,
}: {
    clientSecret: string;
    children: React.ReactNode;
    amount: number;
    onSuccess: (paymentIntent: string) => void;
    onError: (error: string) => void;
}) {
    const t = useTranslations("Checkout.stripe");
    // es, en, fr y zh son locales válidos de Stripe Elements: el formulario de tarjeta sale en el mismo idioma
    const locale = useLocale();

    // Sin llave pública no hay nada que hacer: se avisa al padre en vez de fallar en silencio
    useEffect(() => {
        if (!stripePromise) {
            onError(t("missingKey"));
        }
    }, [onError, t]);

    // Nunca se monta <Elements>/<PaymentElement> sin un clientSecret válido ni sin la llave pública
    if (!clientSecret || !stripePromise) return null;

    const appearance: StripeElementsOptions['appearance'] = {
        theme: "stripe",
        variables: {
            colorPrimary: "#6366F1",
            colorBackground: "#ffffff",
            colorText: "#374151",
            colorDanger: "#EF4444",
            colorSuccess: "#10B981",
            fontFamily: '"Poppins", sans-serif',
            spacingUnit: "4px",
            borderRadius: "6px",
        }
    };

    const options: StripeElementsOptions = {
        clientSecret,
        appearance,
        locale,
    };

    return (
        <Elements stripe={stripePromise} options={options}>
            {children}
        </Elements>
    );
}

export function StripePaymentForm({
    amount,
    orderId,
    onSuccess,
    onError,
}: {
    amount: number;
    orderId: string;
    onSuccess: (paymentIntent: string) => void;
    onError: (error: string) => void;
}) {
    const elements = useElements();
    const stripe = useStripe();
    const [isProcessing, setIsProcessing] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [isReady, setIsReady] = useState(false);
    const t = useTranslations("Checkout.stripe");

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!stripe || !elements) return;
        setIsProcessing(true);
        setErrorMessage(null);

        try {
            // return_url solo se usa si el método de pago exige una redirección completa (ej. 3D Secure);
            // con tarjeta normal, `redirect: "if_required"` resuelve en la misma página
            const { error, paymentIntent } = await stripe.confirmPayment({
                elements,
                confirmParams: {
                    return_url: `${window.location.origin}/checkout/success?orderId=${orderId}`,
                },
                redirect: "if_required",
            });

            if (error) {
                // Error de validación/tarjeta (ej. incompleta, rechazada): se queda local, junto al botón.
                // No se propaga con onError() para no duplicar el mismo texto en el panel del padre.
                setErrorMessage(error.message || t("genericError"));
            } else if (paymentIntent?.status === "succeeded" || paymentIntent?.status === "processing") {
                onSuccess(paymentIntent.id);
            }
        } catch {
            setErrorMessage(t("unexpectedError"));
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className={styles.form}>
            {!isReady && (
                <div className={styles.loadingSkeleton}>
                    <Loader2 className={styles.spinner} />
                    <span>{t("loadingForm")}</span>
                </div>
            )}

            <PaymentElement
                onReady={() => setIsReady(true)}
                onLoadError={(event) => {
                    onError(event.error?.message || t("loadFailed"));
                }}
            />

            {errorMessage && <p className={styles.errorMessage}>{errorMessage}</p>}

            <div className={styles.submitContainer}>
                <button
                    type="submit"
                    disabled={!stripe || !isReady || isProcessing}
                    className={styles.submitButton}
                >
                    {isProcessing ? (
                        <>
                            <Loader2 className={styles.spinner} /> {t("processing")}
                        </>
                    ) : (
                        t("pay", { amount: amount.toFixed(2) })
                    )}
                </button>
            </div>
        </form>
    );
}

// Botón de pago / estado mostrado mientras se genera el clientSecret o si hubo que reintentar
export function StripePaymentPlaceholder({
    amount,
    isLoading,
    onRetry,
}: {
    amount: number;
    isLoading: boolean;
    onRetry?: () => void;
}) {
    const t = useTranslations("Checkout.stripe");
    const tPayment = useTranslations("Checkout.payment");

    return (
        <div className={styles.form}>
            {isLoading && (
                <div className={styles.loadingSkeleton}>
                    <Loader2 className={styles.spinner} />
                    <span>{t("starting")}</span>
                </div>
            )}
            <div className={styles.submitContainer}>
                {onRetry ? (
                    <button type="button" onClick={onRetry} className={styles.retryButton}>
                        {tPayment("retryPrepare")}
                    </button>
                ) : (
                    <button type="button" disabled className={styles.submitButton}>
                        {isLoading ? (
                            <>
                                <Loader2 className={styles.spinner} /> {t("preparing")}
                            </>
                        ) : (
                            t("pay", { amount: amount.toFixed(2) })
                        )}
                    </button>
                )}
            </div>
        </div>
    );
}
