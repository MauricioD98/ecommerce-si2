import { PaymentMethod } from '@prisma/client';

const envMs = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const HOUR = 60 * 60 * 1000;

// Política de vencimientos, siempre con el reloj del servidor. Valores por defecto:
//  - carrito: 1 h sin actividad (la regla que ya existía)
//  - tarjeta/QR: 1 h para pagar; un pago en `processing` extiende la reserva RECONCILIATION_HOLD
//  - manual (QR bancario, USDT, billetera) sin comprobante: 24 h. Con comprobante PENDIENTE no vence:
//    decide la revisión de la tienda
export const cartReservationTtlMs = () => envMs('CART_RESERVATION_TTL_MS', HOUR);
export const reconciliationHoldMs = () => envMs('PAYMENT_RECONCILIATION_HOLD_MS', 6 * HOUR);

// Medios que la tienda verifica a mano con un comprobante. Única lista: el vencimiento y la recepción del
// comprobante no pueden discrepar sobre qué es un pago manual.
export const MANUAL_PAYMENT_METHODS: readonly PaymentMethod[] = [PaymentMethod.BANK_QR, PaymentMethod.USDT, PaymentMethod.WALLET];

export function orderPaymentTtlMs(method: PaymentMethod): number {
  if (MANUAL_PAYMENT_METHODS.includes(method)) return envMs('ORDER_TTL_MANUAL_MS', 24 * HOUR);
  return envMs('ORDER_TTL_CARD_MS', HOUR);
}

// Stripe garantiza idempotencia al menos 24 h: después de este horizonte no se reenvía la misma clave a
// ciegas, se busca el PaymentIntent por metadata (PaymentsService.recoverAttempt).
export const STRIPE_IDEMPOTENCY_HORIZON_MS = 23 * HOUR;

export const MAX_LINE_QUANTITY = 100;

// Moneda de cobro con tarjeta: la fija el servidor, jamás el cliente.
// Moneda en la que se cobra con Stripe. Los precios del catálogo están en bolivianos (la tienda los muestra
// como "Bs"): cobrar el mismo número en otra moneda cambiaría el importe real. Por eso el valor por
// defecto es BOB, y el checkout solo ofrece tarjeta si esta moneda coincide con la que muestra.
export const paymentCurrency = () => (process.env.PAYMENT_CURRENCY?.trim() || 'bob').toLowerCase();

const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf']);
const THREE_DECIMAL = new Set(['bhd', 'jod', 'kwd', 'omr', 'tnd']);

/** Unidades menores de Stripe. Decimal como texto: no pasa por binario de punto flotante. */
export function toMinorUnits(amount: { toString(): string }, currency: string): number {
  const digits = ZERO_DECIMAL.has(currency) ? 0 : THREE_DECIMAL.has(currency) ? 3 : 2;
  const [whole, fraction = ''] = amount.toString().split('.');
  const scaled = `${whole}${fraction.padEnd(digits + 1, '0').slice(0, digits)}`;
  const next = Number(fraction[digits] ?? '0');
  const value = Number(scaled);
  return next >= 5 ? value + 1 : value;
}

// QR simulado y confirmación automática con tarjeta de prueba: solo fuera de producción, con opt-in
// explícito y clave de test. Sin rutas alternativas: todo pasa por esta única comprobación.
export function simulatedPaymentsEnabled(): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.ALLOW_SIMULATED_PAYMENTS === 'true' &&
    Boolean(process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_'))
  );
}

export const backgroundJobsEnabled = () => process.env.DISABLE_BACKGROUND_JOBS !== 'true';
