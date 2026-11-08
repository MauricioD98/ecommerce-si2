// Crea (o reutiliza) en el SANDBOX de Stripe los productos y Prices de los planes del SaaS, mensuales y
// anuales, y la configuración del Billing Portal para cambiar de plan o de intervalo. Después escribe los
// price_... y el bpc_... en api/.env. Script independiente: no levanta Nest.
//
//   npm run build
//   npm run stripe:sandbox-plans
//
// Solo acepta una clave sk_test_: nunca toca una cuenta en modo live. Es idempotente: los Prices se
// buscan por lookup_key (novasoft_<plan>_<intervalo>) y se reutilizan si ya existen con el mismo monto.
// Los montos salen de PLANS en src/modules/platform/plans.ts (anual = 10 meses).
import { readFileSync, writeFileSync } from 'node:fs';
import Stripe from 'stripe';
import { BILLING_INTERVALS, PLANS, PLAN_CURRENCY, type BillingInterval, type PlanKey, priceEnvFor } from '../modules/platform/plans';

const ENV_FILE = '.env';
const PRODUCT_TAG = 'novasoft_plan';
const PORTAL_TAG = 'novasoft_plans';

function loadDotEnv(): void {
  try {
    process.loadEnvFile(ENV_FILE); // no pisa variables ya definidas en el entorno
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

const lookupKey = (plan: PlanKey, interval: BillingInterval) => `novasoft_${plan}_${interval}`;
const stripeInterval = (interval: BillingInterval): 'month' | 'year' => (interval === 'annual' ? 'year' : 'month');

async function ensureProduct(stripe: Stripe, plan: PlanKey): Promise<Stripe.Product> {
  // Búsqueda por metadata con list (search no está disponible en todas las cuentas)
  for await (const product of stripe.products.list({ limit: 100 })) {
    if (product.metadata?.[PRODUCT_TAG] === plan) {
      if (!product.active) return await stripe.products.update(product.id, { active: true });
      return product;
    }
  }
  return await stripe.products.create({
    name: `NovaSoft ${PLANS[plan].name}`,
    description: `Plan ${PLANS[plan].name} de la plataforma NovaSoft (demo)`,
    metadata: { [PRODUCT_TAG]: plan },
  });
}

async function ensurePrice(stripe: Stripe, product: Stripe.Product, plan: PlanKey, interval: BillingInterval): Promise<Stripe.Price> {
  const key = lookupKey(plan, interval);
  const amount = PLANS[plan].amounts[interval];
  const existing = (await stripe.prices.list({ lookup_keys: [key], active: true, limit: 1 })).data[0];
  if (
    existing &&
    existing.unit_amount === amount &&
    existing.currency === PLAN_CURRENCY &&
    existing.recurring?.interval === stripeInterval(interval) &&
    (typeof existing.product === 'string' ? existing.product : existing.product.id) === product.id
  ) {
    return existing;
  }
  // Un Price no se puede editar: si cambió el monto se crea otro y se le transfiere el lookup_key
  return await stripe.prices.create({
    product: product.id,
    currency: PLAN_CURRENCY,
    unit_amount: amount,
    recurring: { interval: stripeInterval(interval) },
    lookup_key: key,
    transfer_lookup_key: true,
    nickname: `${PLANS[plan].name} ${interval === 'annual' ? 'anual' : 'mensual'}`,
    metadata: { [PRODUCT_TAG]: plan, interval },
  });
}

async function ensurePortal(stripe: Stripe, products: { product: string; prices: string[] }[]): Promise<Stripe.BillingPortal.Configuration> {
  const params: Stripe.BillingPortal.ConfigurationCreateParams = {
    business_profile: { headline: 'NovaSoft: administra tu suscripción' },
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end' },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ['price'],
        proration_behavior: 'create_prorations',
        products,
      },
    },
    metadata: { [PORTAL_TAG]: '1' },
  };
  for await (const config of stripe.billingPortal.configurations.list({ active: true, limit: 100 })) {
    if (config.metadata?.[PORTAL_TAG] === '1') {
      return await stripe.billingPortal.configurations.update(config.id, {
        business_profile: params.business_profile,
        features: params.features,
      });
    }
  }
  return await stripe.billingPortal.configurations.create(params);
}

/** Reemplaza KEY=... si existe (aunque esté vacía); si no, la agrega después de la clave `after`. */
function setEnv(text: string, key: string, value: string, after: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const line = new RegExp(`^${key}=.*$`, 'm');
  if (line.test(text)) return text.replace(line, `${key}=${value}`);
  const anchor = new RegExp(`^${after}=.*$`, 'm');
  if (anchor.test(text)) return text.replace(anchor, (match) => `${match}${eol}${key}=${value}`);
  return `${text.replace(/\s*$/, '')}${eol}${key}=${value}${eol}`;
}

async function main(): Promise<void> {
  loadDotEnv();
  const secret = process.env.STRIPE_SECRET_KEY?.trim() ?? '';
  if (!secret.startsWith('sk_test_')) {
    throw new Error('STRIPE_SECRET_KEY debe ser una clave de sandbox (sk_test_...). Este script nunca usa una cuenta live.');
  }
  const stripe = new Stripe(secret);

  const ids: Record<string, string> = {};
  const portalProducts: { product: string; prices: string[] }[] = [];
  for (const plan of Object.keys(PLANS) as PlanKey[]) {
    const product = await ensureProduct(stripe, plan);
    const prices: string[] = [];
    for (const interval of BILLING_INTERVALS) {
      const price = await ensurePrice(stripe, product, plan, interval);
      ids[priceEnvFor(plan, interval)] = price.id;
      prices.push(price.id);
      const shown = (price.unit_amount! / 100).toFixed(2);
      console.log(`${PLANS[plan].name.padEnd(8)} ${interval.padEnd(8)} ${price.id}  ${shown} ${price.currency.toUpperCase()}/${price.recurring?.interval}`);
    }
    portalProducts.push({ product: product.id, prices });
  }
  const portal = await ensurePortal(stripe, portalProducts);
  console.log(`Billing Portal   ${portal.id}`);

  let env = readFileSync(ENV_FILE, 'utf8');
  for (const plan of Object.keys(PLANS) as PlanKey[]) {
    env = setEnv(env, priceEnvFor(plan, 'monthly'), ids[priceEnvFor(plan, 'monthly')], 'STRIPE_WEBHOOK_SECRET');
  }
  for (const plan of Object.keys(PLANS) as PlanKey[]) {
    env = setEnv(env, priceEnvFor(plan, 'annual'), ids[priceEnvFor(plan, 'annual')], priceEnvFor(plan, 'monthly'));
  }
  env = setEnv(env, 'STRIPE_PORTAL_CONFIGURATION', portal.id, priceEnvFor('pro', 'annual'));
  writeFileSync(ENV_FILE, env);
  console.log(`\nVariables escritas en api/${ENV_FILE}. Reinicia la API para que las lea.`);
}

main().catch((error: Error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
