// Planes que muestra la landing y el panel de suscripción. `key` + `interval` es lo único que viaja al
// backend: el price_id real lo elige la API (api/src/modules/platform/plans.ts → STRIPE_PRICE_* y
// STRIPE_PRICE_*_ANNUAL). Los montos de acá son el respaldo para mostrar mientras se cargan los reales
// de Stripe (GET /platform/subscriptions/plans, ver usePlanPrices) y deben coincidir con ellos.
//
// Anual = 10 meses (2 meses gratis). Descripción y características: messages/<idioma>.json → "Plans.<key>".
export type PlanKey = "starter" | "growth" | "pro";
export type BillingInterval = "monthly" | "annual";
export const BILLING_INTERVALS: BillingInterval[] = ["monthly", "annual"];

export interface Plan {
    key: PlanKey;
    name: string;
    // USD por período (respaldo; el precio real sale de Stripe)
    amounts: Record<BillingInterval, number>;
    highlighted?: boolean;
}

export const PLANS: Plan[] = [
    { key: "starter", name: "Starter", amounts: { monthly: 11.5, annual: 115 } },
    { key: "growth", name: "Growth", amounts: { monthly: 21.5, annual: 215 }, highlighted: true },
    { key: "pro", name: "Pro", amounts: { monthly: 36, annual: 360 } },
];

/** "$11.50" (montos en USD, con 2 decimales como en Stripe Checkout). */
export function formatPlanPrice(amount: number, currency = "USD"): string {
    return currency === "USD" ? `$${amount.toFixed(2)}` : `${amount.toFixed(2)} ${currency}`;
}
