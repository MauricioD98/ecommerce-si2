import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, describe, it } from 'node:test';
import Stripe from 'stripe';

// Contra la API REAL de Stripe, solo en modo test. Comprueba las suposiciones que el Stripe falso no puede
// demostrar. Sin STRIPE_TEST_SECRET_KEY se omite; con una clave que no sea sk_test_ falla antes de hacer nada.
const KEY = process.env.STRIPE_TEST_SECRET_KEY;

describe('Stripe real en modo test', { skip: !KEY }, () => {
  let stripe: Stripe;
  const base = { amount: 1234, currency: 'usd', metadata: { suite: 'stella-acceptance' }, automatic_payment_methods: { enabled: true, allow_redirects: 'never' as const } };

  before(() => {
    assert.ok(KEY!.startsWith('sk_test_'), 'Solo se admite una clave de modo test');
    stripe = new Stripe(KEY!);
  });

  it('P01: la misma clave idempotente devuelve el mismo PaymentIntent, y con otros parámetros falla', async () => {
    const key = `sf-acceptance-${randomUUID()}`;
    const first = await stripe.paymentIntents.create(base, { idempotencyKey: key });
    const replay = await stripe.paymentIntents.create(base, { idempotencyKey: key });
    assert.equal(first.id, replay.id);
    assert.equal(first.livemode, false);
    await assert.rejects(stripe.paymentIntents.create({ ...base, amount: 999 }, { idempotencyKey: key }), (error: any) => error.type === 'StripeIdempotencyError');
    await stripe.paymentIntents.cancel(first.id);
  });

  it('P04: tarjeta exitosa, 3DS y rechazo llegan con los estados que el servidor distingue', async () => {
    const ok = await stripe.paymentIntents.create({ ...base, payment_method: 'pm_card_visa', confirm: true });
    assert.equal(ok.status, 'succeeded');

    const threeDs = await stripe.paymentIntents.create({ ...base, payment_method: 'pm_card_authenticationRequired', confirm: true });
    assert.equal(threeDs.status, 'requires_action', 'requiere al usuario: no es pagado');
    await stripe.paymentIntents.cancel(threeDs.id);

    await assert.rejects(stripe.paymentIntents.create({ ...base, payment_method: 'pm_card_chargeDeclined', confirm: true }), (error: any) => error.type === 'StripeCardError');
  });

  it('P02: cancelar un PI ya cobrado se rechaza y permite ver el pago real', async () => {
    const paid = await stripe.paymentIntents.create({ ...base, payment_method: 'pm_card_visa', confirm: true });
    await assert.rejects(stripe.paymentIntents.cancel(paid.id), (error: any) => error.type === 'StripeInvalidRequestError');
    assert.equal((await stripe.paymentIntents.retrieve(paid.id)).status, 'succeeded');
  });

  it('P06: reintentar el reembolso con la misma clave no devuelve dos veces', async () => {
    const paid = await stripe.paymentIntents.create({ ...base, payment_method: 'pm_card_visa', confirm: true });
    const key = `sf-acceptance-refund-${randomUUID()}`;
    const refund = await stripe.refunds.create({ payment_intent: paid.id }, { idempotencyKey: key });
    const again = await stripe.refunds.create({ payment_intent: paid.id }, { idempotencyKey: key });
    assert.equal(refund.id, again.id);
    assert.equal((await stripe.refunds.list({ payment_intent: paid.id })).data.length, 1);
  });

  it('Connect: destination charge con comisión y reembolso con reversión, si hay cuenta conectada de prueba', async (t) => {
    const accounts = await stripe.accounts.list({ limit: 20 });
    const account = accounts.data.find((a) => a.charges_enabled && a.capabilities?.transfers === 'active');
    if (!account) return t.skip('La cuenta de prueba no tiene una cuenta conectada habilitada');
    const paid = await stripe.paymentIntents.create({
      ...base,
      payment_method: 'pm_card_visa',
      confirm: true,
      on_behalf_of: account.id,
      transfer_data: { destination: account.id },
      application_fee_amount: 30,
    });
    assert.equal(paid.status, 'succeeded');
    const refund = await stripe.refunds.create({ payment_intent: paid.id, reverse_transfer: true, refund_application_fee: true }, { idempotencyKey: `sf-acceptance-refund-${randomUUID()}` });
    assert.ok(['succeeded', 'pending'].includes(refund.status ?? ''));
  });
});
