// Metadatos de estado compartidos por la lista de pedidos y el timeline de seguimiento
export type OrderStatusValue = "PENDIENTE" | "PROCESANDO" | "ENVIADO" | "ENTREGADO" | "CANCELADO";

export const ORDER_STATUS_LABELS: Record<OrderStatusValue, string> = {
    PENDIENTE: "Pendiente",
    PROCESANDO: "Preparando",
    ENVIADO: "Enviado",
    ENTREGADO: "Entregado",
    CANCELADO: "Cancelado",
};

// Color semántico del badge por estado (pendiente=amarillo, procesando/enviado=azul, entregado=verde, cancelado=rojo)
export const ORDER_STATUS_BADGE_CLASS: Record<OrderStatusValue, string> = {
    PENDIENTE: "badgeWarning",
    PROCESANDO: "badgeInfo",
    ENVIADO: "badgeInfo",
    ENTREGADO: "badgeSuccess",
    CANCELADO: "badgeDanger",
};

// Pasos del timeline de tracking, en orden. CANCELADO se maneja aparte (no tiene un paso propio en la barra)
export const ORDER_TIMELINE_STEPS: { status: OrderStatusValue; label: string }[] = [
    { status: "PENDIENTE", label: "Pago confirmado" },
    { status: "PROCESANDO", label: "Preparando" },
    { status: "ENVIADO", label: "En camino" },
    { status: "ENTREGADO", label: "Entregado" },
];

// Estado del pago con Stripe (enum aparte del estado logístico del pedido)
export const PAYMENT_STATUS_LABELS: Record<string, string> = {
    PENDIENTE: "Pendiente",
    COMPLETADO: "Pagado",
    FALLIDO: "Fallido",
    REEMBOLSADO: "Reembolsado",
};

export const formatOrderDate = (value: string) =>
    new Date(value).toLocaleDateString("es-BO", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
