// Planes de suscripción al SaaS. El cliente solo elige la CLAVE del plan; el price_id real sale de
// variables de entorno del backend. Nunca se acepta un price_id del front: cualquiera podría
// mandar el de un precio más barato (o de otro producto de la misma cuenta de Stripe).
//
// Los montos que muestra la landing (front/components/modules/platform/plans.ts) tienen que
// coincidir con los Prices configurados en Stripe.
export const PLANS = {
  starter: { name: 'Starter', priceEnv: 'STRIPE_PRICE_STARTER' },
  growth: { name: 'Growth', priceEnv: 'STRIPE_PRICE_GROWTH' },
  pro: { name: 'Pro', priceEnv: 'STRIPE_PRICE_PRO' },
} as const;

export type PlanKey = keyof typeof PLANS;

export const PLAN_KEYS = Object.keys(PLANS) as PlanKey[];

export function priceIdFor(plan: PlanKey): string | null {
  const priceId = process.env[PLANS[plan].priceEnv]?.trim();
  return priceId?.startsWith('price_') ? priceId : null;
}

// Inverso de priceIdFor: un cambio de plan hecho en el Billing Portal llega como un price_id
export function planForPrice(priceId: string | null | undefined): PlanKey | null {
  if (!priceId) return null;
  return PLAN_KEYS.find((plan) => priceIdFor(plan) === priceId) ?? null;
}

/** Al arrancar: avisa qué falta para cobrar suscripciones, sin tumbar la API (el resto funciona). */
export function missingBillingEnv(): string[] {
  const missing = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'].filter((key) => !process.env[key]?.trim());
  if (process.env.STRIPE_SECRET_KEY && !/^sk_(test|live)_/.test(process.env.STRIPE_SECRET_KEY)) {
    missing.push('STRIPE_SECRET_KEY (debe empezar con sk_test_ o sk_live_)');
  }
  if (process.env.STRIPE_WEBHOOK_SECRET && !process.env.STRIPE_WEBHOOK_SECRET.startsWith('whsec_')) {
    missing.push('STRIPE_WEBHOOK_SECRET (debe empezar con whsec_)');
  }
  for (const plan of PLAN_KEYS) {
    if (!priceIdFor(plan)) missing.push(`${PLANS[plan].priceEnv} (price_...)`);
  }
  return missing;
}
