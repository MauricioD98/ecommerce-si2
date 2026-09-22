import React, { useEffect, useState } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, StripeElementsOptions } from "@stripe/stripe-js";
import styles from "./stripe-payment-form.module.scss"; // Ajusta ruta si es necesario
import { Loader2 } from "lucide-react"; // Importando Loader2 correctamente

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
    // Sin llave pública no hay nada que hacer: se avisa al padre en vez de fallar en silencio
    useEffect(() => {
        if (!stripePromise) {
            onError('No se pudo inicializar Stripe: falta configurar NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.');
        }
    }, [onError]);

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
        appearance
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
                setErrorMessage(error.message || "Algo salió mal");
            } else if (paymentIntent?.status === "succeeded") {
                onSuccess(paymentIntent.id);
            }
        } catch {
            setErrorMessage("Ocurrió un error inesperado. Inténtalo de nuevo.");
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className={styles.form}>
            <PaymentElement
                onLoadError={(event) => {
                    // Este es el "Unhandled payment Element loaderror": casi siempre clientSecret/llave pública
                    // de cuentas de Stripe distintas, o clientSecret vencido/inválido. Es un fallo bloqueante
                    // (el formulario no funciona), así que solo se avisa al padre, no aquí abajo del botón.
                    onError(event.error?.message || 'No se pudo cargar el formulario de pago. Verifica la configuración de Stripe.');
                }}
            />

            {/* Único lugar para el error de pago (validación de Stripe al confirmar): Stripe ya marca
                los campos incompletos dentro del propio PaymentElement, esto solo cubre el resultado general */}
            {errorMessage && <p className={styles.errorMessage}>{errorMessage}</p>}

            <div className={styles.submitContainer}>
                <button
                    type="submit"
                    disabled={!stripe || isProcessing}
                    className={styles.submitButton}
                >
                    {isProcessing ? (
                        <>
                            <Loader2 className={styles.spinner} /> Procesando...
                        </>
                    ) : (
                        `Pagar $${amount.toFixed(2)}`
                    )}
                </button>
            </div>
        </form>
    );
}

// Botón de pago mostrado mientras aún no existe el clientSecret (la orden se está creando).
// La animación de carga vive únicamente dentro del botón.
export function StripePaymentPlaceholder({
    amount,
    isLoading,
}: {
    amount: number;
    isLoading: boolean;
}) {
    return (
        <div className={styles.form}>
            <div className={styles.submitContainer}>
                <button type="button" disabled className={styles.submitButton}>
                    {isLoading ? (
                        <>
                            <Loader2 className={styles.spinner} /> Preparando pago...
                        </>
                    ) : (
                        `Pagar $${amount.toFixed(2)}`
                    )}
                </button>
            </div>
        </div>
    );
}
