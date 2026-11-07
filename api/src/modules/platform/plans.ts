import { ForbiddenException } from '@nestjs/common';
import { i18nMessage } from '../../i18n/i18n-message';
import { requireTenant } from '../../tenancy/tenant-context';

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

export interface PlanFeatures {
  planKey: 'starter' | 'growth' | 'pro' | 'legacy';
  planName: string;
  maxBranches: number | null;
  maxProducts: number | null;
  pos: boolean;
  returns: boolean;
  multiBranchInventory: boolean;
  customDomain: boolean;
  aiReports: boolean;
  virtualTryOn: boolean;
  campaigns: boolean;
  qrPayments: boolean;
  digitalWallet: boolean;
  mobileApp: boolean;
}

export type PlanBooleanFeature = {
  [K in keyof PlanFeatures]: PlanFeatures[K] extends boolean ? K : never;
}[keyof PlanFeatures];

const PLAN_FEATURES_MAP: Record<PlanFeatures['planKey'], PlanFeatures> = {
  starter: {
    planKey: 'starter',
    planName: 'Starter',
    maxBranches: 1,
    maxProducts: 200,
    pos: false,
    returns: false,
    multiBranchInventory: false,
    customDomain: false,
    aiReports: false,
    virtualTryOn: false,
    campaigns: false,
    qrPayments: true,
    digitalWallet: false,
    mobileApp: false,
  },
  growth: {
    planKey: 'growth',
    planName: 'Growth',
    maxBranches: 5,
    maxProducts: null,
    pos: true,
    returns: true,
    multiBranchInventory: true,
    customDomain: true,
    aiReports: false,
    virtualTryOn: false,
    campaigns: false,
    qrPayments: true,
    digitalWallet: true,
    mobileApp: false,
  },
  pro: {
    planKey: 'pro',
    planName: 'Pro',
    maxBranches: null,
    maxProducts: null,
    pos: true,
    returns: true,
    multiBranchInventory: true,
    customDomain: true,
    aiReports: true,
    virtualTryOn: true,
    campaigns: true,
    qrPayments: true,
    digitalWallet: true,
    mobileApp: true,
  },
  legacy: {
    planKey: 'legacy',
    planName: 'Pro',
    maxBranches: null,
    maxProducts: null,
    pos: true,
    returns: true,
    multiBranchInventory: true,
    customDomain: true,
    aiReports: true,
    virtualTryOn: true,
    campaigns: true,
    qrPayments: true,
    digitalWallet: true,
    mobileApp: true,
  },
};

// Orden de los planes a la venta, del más barato al más caro (legacy no se vende)
const PLAN_ORDER = ['starter', 'growth', 'pro'] as const;

/**
 * Nombre del plan más barato que cumple `test`: es el que nombran los mensajes de "actualiza tu
 * plan". Sale de PLAN_FEATURES_MAP para que los mensajes no queden desalineados si se mueve una
 * funcionalidad de plan.
 */
export function minimumPlanName(test: (features: PlanFeatures) => boolean): string {
  const planKey = PLAN_ORDER.find((key) => test(PLAN_FEATURES_MAP[key])) ?? 'pro';
  return PLAN_FEATURES_MAP[planKey].planName;
}

/**
 * Error de funcionalidad no incluida en el plan: una clave por funcionalidad (cada idioma arma la
 * frase completa con su propia concordancia), con el plan necesario como argumento. Lo traduce
 * I18nExceptionFilter (diccionarios en src/i18n/locales/<idioma>/errors.json → PLAN_FEATURE).
 */
export function planFeatureMessage(feature: PlanBooleanFeature): string {
  return i18nMessage(`errors.PLAN_FEATURE.${feature}`, { plan: minimumPlanName((features) => features[feature]) });
}

/** Tope de productos activos alcanzado (crear o desarchivar): nombra el primer plan sin tope. */
export function productLimitMessage(features: PlanFeatures): string {
  return i18nMessage('errors.PLAN_PRODUCT_LIMIT', {
    plan: features.planName,
    count: features.maxProducts,
    upgradePlan: minimumPlanName((plan) => plan.maxProducts === null),
  });
}

export function getPlanFeatures(rawPlan: string | null | undefined): PlanFeatures {
  const normalized = rawPlan?.trim().toLowerCase();
  if (normalized === 'pro') return PLAN_FEATURES_MAP.pro;
  if (normalized === 'growth') return PLAN_FEATURES_MAP.growth;
  if (normalized === 'legacy') return PLAN_FEATURES_MAP.legacy;
  return PLAN_FEATURES_MAP.starter;
}

export function currentPlanFeatures(): PlanFeatures {
  const ctx = requireTenant();
  return getPlanFeatures(ctx.plan);
}

export function assertPlanFeature(feature: PlanBooleanFeature): void {
  const features = currentPlanFeatures();
  if (!features[feature]) {
    throw new ForbiddenException(planFeatureMessage(feature));
  }
}

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
