import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';

// Único punto de salida hacia Stripe para las ventas de las tiendas. STRIPE_API_BASE permite apuntar a
// un Stripe falso local en las pruebas deterministas; fuera de NODE_ENV=test se ignora siempre.
export function createStripeClient(): Stripe {
  const base = process.env.NODE_ENV === 'test' ? process.env.STRIPE_API_BASE : undefined;
  if (!base) return new Stripe(process.env.STRIPE_SECRET_KEY!, { maxNetworkRetries: 2 });
  const url = new URL(base);
  return new Stripe(process.env.STRIPE_SECRET_KEY!, {
    host: url.hostname,
    port: Number(url.port),
    protocol: url.protocol.replace(':', '') as 'http' | 'https',
    maxNetworkRetries: 0,
  });
}

export function isProviderUnavailable(error: unknown): boolean {
  const type = (error as { type?: string })?.type;
  return type === 'StripeConnectionError' || type === 'StripeAPIError' || type === 'StripeRateLimitError';
}

@Injectable()
export class StripeGateway {
  readonly client: Stripe = createStripeClient();
  // Modo de la clave: un PaymentIntent de otro modo nunca se acepta
  readonly livemode = !process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_');

  createPaymentIntent(params: Stripe.PaymentIntentCreateParams, idempotencyKey: string): Promise<Stripe.PaymentIntent> {
    return this.client.paymentIntents.create(params, { idempotencyKey });
  }

  retrieve(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
    return this.client.paymentIntents.retrieve(paymentIntentId);
  }

  cancel(paymentIntentId: string, idempotencyKey: string): Promise<Stripe.PaymentIntent> {
    return this.client.paymentIntents.cancel(paymentIntentId, {}, { idempotencyKey });
  }

  /** Busca por metadata: se usa después del horizonte de idempotencia, en vez de crear otro cobro a ciegas */
  async findByAttempt(attemptId: string): Promise<Stripe.PaymentIntent | null> {
    const { data } = await this.client.paymentIntents.search({ query: `metadata['attemptId']:'${attemptId}'`, limit: 1 });
    return data[0] ?? null;
  }

  /**
   * Reembolso idempotente. En destination charges revierte también la transferencia a la cuenta de la
   * tienda y la comisión de la plataforma, para que el dinero no salga solo del saldo de la plataforma.
   */
  refundDestinationCharge(paymentIntentId: string, idempotencyKey: string): Promise<Stripe.Refund> {
    return this.client.refunds.create(
      { payment_intent: paymentIntentId, reverse_transfer: true, refund_application_fee: true },
      { idempotencyKey },
    );
  }

  verifyWebhook(rawBody: Buffer, signature: string, secret: string): Stripe.Event {
    return this.client.webhooks.constructEvent(rawBody, signature, secret);
  }
}
