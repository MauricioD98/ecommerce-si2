// Planes que muestra la landing. `key` es lo único que viaja al backend: el price_id real lo elige
// la API (api/src/modules/platform/plans.ts → STRIPE_PRICE_*). Los montos de acá son solo para
// mostrar y TIENEN que coincidir con los Prices configurados en Stripe.
//
// Descripción y características están en messages/<idioma>.json → "Plans.<key>".
export type PlanKey = "starter" | "growth" | "pro";

export interface Plan {
    key: PlanKey;
    name: string;
    price: string;
    highlighted?: boolean;
}

export const PLANS: Plan[] = [
    { key: "starter", name: "Starter", price: "$11.50" },
    { key: "growth", name: "Growth", price: "$21.50", highlighted: true },
    { key: "pro", name: "Pro", price: "$36.00" },
];
