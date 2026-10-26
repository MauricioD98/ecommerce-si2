// Metadatos de estado compartidos por la lista de pedidos y el timeline de seguimiento.
// Los textos viven en messages/<idioma>.json → Account.status / Account.timeline / Account.payment.
import { intlLocale } from "@/i18n/config";

export type OrderStatusValue = "PENDIENTE" | "PROCESANDO" | "ENVIADO" | "ENTREGADO" | "CANCELADO";

// Color semántico del badge por estado (pendiente=amarillo, procesando/enviado=azul, entregado=verde, cancelado=rojo)
export const ORDER_STATUS_BADGE_CLASS: Record<OrderStatusValue, string> = {
    PENDIENTE: "badgeWarning",
    PROCESANDO: "badgeInfo",
    ENVIADO: "badgeInfo",
    ENTREGADO: "badgeSuccess",
    CANCELADO: "badgeDanger",
};

export const ORDER_STATUSES: OrderStatusValue[] = ["PENDIENTE", "PROCESANDO", "ENVIADO", "ENTREGADO", "CANCELADO"];

// Pasos del timeline de tracking, en orden. CANCELADO se maneja aparte (no tiene un paso propio en la barra)
export const ORDER_TIMELINE_STEPS = ["PENDIENTE", "PROCESANDO", "ENVIADO", "ENTREGADO"] as const;

// Estado del pago con Stripe (enum aparte del estado logístico del pedido)
export const PAYMENT_STATUSES = ["PENDIENTE", "COMPLETADO", "FALLIDO", "REEMBOLSADO"] as const;
export type PaymentStatusValue = (typeof PAYMENT_STATUSES)[number];

export const isOrderStatus = (value: string): value is OrderStatusValue =>
    (ORDER_STATUSES as string[]).includes(value);

export const isPaymentStatus = (value: string): value is PaymentStatusValue =>
    (PAYMENT_STATUSES as readonly string[]).includes(value);

export const formatOrderDate = (value: string, locale: string) =>
    new Date(value).toLocaleDateString(intlLocale(locale), {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
