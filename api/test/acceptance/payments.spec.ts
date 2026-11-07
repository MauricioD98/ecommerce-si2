import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { FakeStripe } from './support/fake-stripe';
import { clearFailpoints, setFailpoint } from '../../src/common/checkout/failpoints';
import { simulatedPaymentsEnabled, toMinorUnits } from '../../src/common/checkout/checkout-policy';
import { CheckoutMaintenanceService } from '../../src/modules/payments/checkout-maintenance.service';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import {
  Api,
  TENANT_A,
  TENANT_B,
  apiFor,
  assertConservation,
  barrier,
  bootApp,
  count,
  createProduct,
  createUser,
  inTenantA,
  inTenantB,
  key,
  queryRows,
  seedTenant,
  stockOf,
  withSql,
  type Fixture,
} from './support/world';

const schema = TENANT_A.schemaName;
const tenant = TENANT_A.tenantId;
const REVIEW_PERMISSIONS = ['VIEW_ORDERS', 'ALL_BRANCHES'];

describe('Pagos, webhooks, vencimientos y compensaciones', () => {
  let app: INestApplication;
  let fx: Fixture;
  let stripe: FakeStripe;
  let payments: PaymentsService;
  let maintenance: CheckoutMaintenanceService;

  const buyer = async () => {
    const id = await createUser(schema, fx);
    return { id, api: await apiFor(app, tenant, id) };
  };

  // Orden PICKUP de 100.00 con reserva consumida
  const orderFor = async (api: Api, stock = 5) => {
    const productId = await createProduct(schema, fx, { [fx.branchA]: { M: stock } });
    await api.addToCart(productId, 1, 'M', fx.branchA);
    const res = await api.createOrder({ key: key(), cartVersion: await api.cartVersion(), items: [{ productId, quantity: 1, size: 'M' }], branchId: fx.branchA });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return { orderId: res.body.data.id as string, productId };
  };

  const createIntent = (api: Api, orderId: string, extra: Record<string, unknown> = {}) =>
    api.call('POST', '/payments/create-intent', { body: { orderId, ...extra } });

  const sendWebhook = (api: Api, event: { payload: string; signature: string }) =>
    fetch(`${api.baseUrl}/api/v1/payments/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': event.signature },
      body: event.payload,
    });

  const orderRow = async (orderId: string) => (await queryRows(`SELECT * FROM "${schema}".orders WHERE id=$1`, [orderId]))[0];
  const paymentRow = async (orderId: string) => (await queryRows(`SELECT * FROM "${schema}".payments WHERE "orderId"=$1`, [orderId]))[0];

  before(async () => {
    stripe = new FakeStripe();
    process.env.STRIPE_API_BASE = await stripe.start();
    app = await bootApp();
    fx = await seedTenant(schema);
    payments = app.get(PaymentsService, { strict: false });
    maintenance = app.get(CheckoutMaintenanceService, { strict: false });
  });
  after(async () => {
    await app.close();
    await stripe.stop();
  });
  afterEach(() => {
    clearFailpoints();
    stripe.unavailable = false;
    stripe.cancelRejected = false;
    stripe.searchLag = false;
  });

  it('P01: crear repetidamente y perder la respuesta de Stripe da un único PaymentIntent', async () => {
    const { api } = await buyer();
    const { orderId } = await orderFor(api);
    const before = stripe.intents.size;

    stripe.dropNextCreateResponse = true;
    const createCallsBefore = stripe.createCalls;
    const lost = await createIntent(api, orderId);
    // El agente HTTP puede reintentar el socket cortado con la misma clave (201) o rendirse (503): en ambos
    // casos Stripe creó uno solo, y el resultado queda recuperable
    assert.ok([201, 503].includes(lost.status), String(lost.status));
    if (lost.status === 503) assert.equal(lost.body.code, 'PROVIDER_UNAVAILABLE');
    assert.ok(stripe.createCalls > createCallsBefore);
    assert.equal(stripe.intents.size, before + 1, 'Stripe sí lo creó, una vez');

    const results = await Promise.all([createIntent(api, orderId), createIntent(api, orderId), createIntent(api, orderId)]);
    assert.ok(results.every((r) => r.status === 201), JSON.stringify(results.map((r) => [r.status, r.body])));
    assert.equal(new Set(results.map((r) => r.body.data.paymentIntentId)).size, 1);
    assert.equal(stripe.intents.size, before + 1, 'ningún cobro adicional');

    const attempts = await queryRows(`SELECT * FROM "${schema}".payment_attempts WHERE "orderId"=$1`, [orderId]);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].status, 'OPEN');
    assert.equal(attempts[0].amountMinor, 10000);
    assert.equal(attempts[0].destinationAccount, 'acct_alpha');
    const intent = stripe.intents.get(attempts[0].stripePaymentIntentId)!;
    assert.equal(intent.amount, 10000);
    assert.equal(intent.transfer_data.destination, 'acct_alpha');
    assert.equal(intent.application_fee_amount, 250);
    assert.equal(intent.metadata.tenantId, tenant);

    // Importe y moneda los fija el servidor, aunque el cliente mande otros
    const forged = await createIntent(api, orderId, { amount: 1, currency: 'jpy' });
    assert.equal(forged.status, 201);
    assert.equal(stripe.intents.get(forged.body.data.paymentIntentId)!.amount, 10000);
    assert.equal(stripe.intents.get(forged.body.data.paymentIntentId)!.currency, 'usd');
  });

  it('P02: Stripe crea el PI y la API cae antes de guardarlo: se concilia desde el intento durable', async () => {
    const { api } = await buyer();
    const { orderId } = await orderFor(api);
    const before = stripe.intents.size;
    setFailpoint('payments.afterProviderCreate', () => {
      clearFailpoints();
      throw new Error('crash simulado');
    });
    const crashed = await createIntent(api, orderId);
    assert.equal(crashed.status, 500);
    assert.equal(stripe.intents.size, before + 1);
    const [attempt] = await queryRows(`SELECT * FROM "${schema}".payment_attempts WHERE "orderId"=$1`, [orderId]);
    assert.equal(attempt.status, 'CREATED', 'el intento quedó persistido antes de llamar a Stripe');
    assert.equal(attempt.stripePaymentIntentId, null);

    // El barrido lo enlaza sin que el cliente vuelva
    await inTenantA(() => payments.recoverStaleAttempts(0));
    const [recovered] = await queryRows(`SELECT * FROM "${schema}".payment_attempts WHERE "orderId"=$1`, [orderId]);
    assert.equal(recovered.status, 'OPEN');
    assert.ok(recovered.stripePaymentIntentId);
    assert.equal(stripe.intents.size, before + 1, 'sin PI huérfano');

    const again = await createIntent(api, orderId);
    assert.equal(again.body.data.paymentIntentId, recovered.stripePaymentIntentId);

    // Fuera del horizonte de idempotencia no se reenvía la clave: se busca por metadata
    const other = await buyer();
    const late = await orderFor(other.api);
    setFailpoint('payments.afterProviderCreate', () => {
      clearFailpoints();
      throw new Error('crash simulado');
    });
    await createIntent(other.api, late.orderId);
    await queryRows(`UPDATE "${schema}".payment_attempts SET "createdAt" = now() - interval '2 days' WHERE "orderId"=$1`, [late.orderId]);
    const created = stripe.createCalls;
    const beyond = await createIntent(other.api, late.orderId);
    assert.equal(beyond.status, 201);
    assert.equal(stripe.createCalls, created, 'sin crear a ciegas');
  });

  it('P03: webhook antes de la respuesta local, duplicados y orden invertido', async () => {
    const { api } = await buyer();
    const { orderId, productId } = await orderFor(api);

    // Webhook llega ANTES de guardar el PI: la API se detiene entre Stripe y el guardado
    const inProvider = barrier();
    const resume = barrier();
    setFailpoint('payments.afterProviderCreate', async () => {
      clearFailpoints();
      inProvider.open();
      await resume.opened;
    });
    const creating = createIntent(api, orderId);
    await inProvider.opened;
    const [attempt] = await queryRows(`SELECT * FROM "${schema}".payment_attempts WHERE "orderId"=$1`, [orderId]);
    assert.equal(attempt.stripePaymentIntentId, null);
    const intent = [...stripe.intents.values()].find((i) => i.metadata.attemptId === attempt.id)!;
    stripe.setStatus(intent.id, 'succeeded');
    const event = stripe.signedEvent('payment_intent.succeeded', intent);
    assert.equal((await sendWebhook(api, event)).status, 200);

    let order = await orderRow(orderId);
    assert.equal(order.paymentStatus, 'COMPLETADO');
    assert.equal(order.status, 'PROCESANDO');
    assert.equal((await paymentRow(orderId)).status, 'COMPLETADO');
    resume.open();
    await creating;

    // Duplicado exacto y un evento distinto con el mismo efecto
    assert.equal((await sendWebhook(api, event)).status, 200);
    assert.equal((await sendWebhook(api, stripe.signedEvent('payment_intent.succeeded', intent))).status, 200);
    assert.equal(await count(schema, 'outbox_events', `"dedupeKey" = $1`, [`order-paid-invoice:${orderId}`]), 1);
    const inbox = await queryRows(`SELECT status FROM public.provider_event_inbox WHERE event_id=$1`, [event.id]);
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].status, 'PROCESSED');

    // Un fallo viejo que llega después no degrada
    const stale = { ...intent, status: 'requires_payment_method' };
    assert.equal((await sendWebhook(api, stripe.signedEvent('payment_intent.payment_failed', stale))).status, 200);
    order = await orderRow(orderId);
    assert.equal(order.paymentStatus, 'COMPLETADO');
    assert.equal(order.status, 'PROCESANDO');
    assert.equal((await stockOf(schema, productId, fx.branchA, 'M'))?.stock, 4);
    await assertConservation(schema, productId, 5);

    // Cierre del cobro: un producto agregado al carrito durante el pago sigue intacto
    const extra = await createProduct(schema, fx, { [fx.branchA]: { M: 2 } });
    const again = await buyer();
    const live = await orderFor(again.api);
    await again.api.addToCart(extra, 1, 'M', fx.branchA);
    const created = await createIntent(again.api, live.orderId);
    const paid = stripe.setStatus(created.body.data.paymentIntentId, 'succeeded');
    await sendWebhook(again.api, stripe.signedEvent('payment_intent.succeeded', paid));
    const cart = await again.api.call('GET', '/cart');
    assert.equal(cart.body.cartItems.length, 1);
    assert.equal(cart.body.cartItems[0].productId, extra);
    assert.equal((await stockOf(schema, extra, fx.branchA, 'M'))?.stock, 1);
    assert.equal(cart.body.checkout, false);
  });

  it('P04: processing, 3DS y rechazo no marcan COMPLETADO antes de la evidencia final', async () => {
    const { api } = await buyer();
    const { orderId } = await orderFor(api);
    const created = await createIntent(api, orderId);
    const pi = created.body.data.paymentIntentId;

    for (const status of ['processing', 'requires_action']) {
      stripe.setStatus(pi, status);
      const res = await api.call('POST', '/payments/confirm', { body: { orderId, paymentIntentId: pi } });
      assert.equal(res.status, 409, status);
      assert.equal(res.body.code, 'PAYMENT_PENDING');
      assert.equal(res.body.providerStatus, status);
      assert.equal((await orderRow(orderId)).paymentStatus, 'PENDIENTE');
    }

    stripe.setStatus(pi, 'requires_payment_method');
    const declined = await api.call('POST', '/payments/confirm', { body: { orderId, paymentIntentId: pi } });
    assert.equal(declined.status, 400);
    await sendWebhook(api, stripe.signedEvent('payment_intent.payment_failed', stripe.intents.get(pi)!));
    assert.equal((await orderRow(orderId)).paymentStatus, 'FALLIDO');
    assert.notEqual((await paymentRow(orderId)).status, 'COMPLETADO');

    // Un fallo no invalida un pago posterior exitoso con el mismo intento
    const retry = await createIntent(api, orderId);
    assert.equal(retry.body.data.paymentIntentId, pi);
    stripe.setStatus(pi, 'succeeded');
    const ok = await api.call('POST', '/payments/confirm', { body: { orderId, paymentIntentId: pi } });
    assert.equal(ok.status, 201);
    assert.equal((await orderRow(orderId)).paymentStatus, 'COMPLETADO');

    // La confirmación exige sesión
    const anonymous = await (await apiFor(app, tenant)).call('POST', '/payments/confirm', { body: { orderId, paymentIntentId: pi } });
    assert.equal(anonymous.status, 401);
  });

  it('P05: pago contra expiración y cobro tardío a compensación', async () => {
    // Expiración gana: stock liberado y cobro tardío reembolsado, sin confirmar entrega
    const { api } = await buyer();
    const { orderId, productId } = await orderFor(api);
    const created = await createIntent(api, orderId);
    const pi = created.body.data.paymentIntentId;
    await queryRows(`UPDATE "${schema}".orders SET "paymentExpiresAt" = now() - interval '1 minute' WHERE id=$1`, [orderId]);
    await inTenantA(() => maintenance.resolveExpiredOrders());
    let order = await orderRow(orderId);
    assert.equal(order.status, 'CANCELADO');
    assert.equal(stripe.intents.get(pi)!.status, 'canceled');
    assert.equal((await stockOf(schema, productId, fx.branchA, 'M'))?.stock, 5);
    assert.equal(await count(schema, 'stock_reservations', `"orderId"=$1 AND status='RELEASED'`, [orderId]), 1);

    // El cobro tardío entra igual (la cancelación compitió con la red del banco)
    stripe.setStatus(pi, 'succeeded');
    await sendWebhook(api, stripe.signedEvent('payment_intent.succeeded', stripe.intents.get(pi)!));
    order = await orderRow(orderId);
    assert.equal(order.status, 'CANCELADO', 'no se confirma entrega sin stock');
    assert.notEqual(order.paymentStatus, 'COMPLETADO');
    assert.equal(order.reconciliationStatus, 'LATE_PAYMENT');
    const [compensation] = await queryRows(`SELECT * FROM "${schema}".payment_compensations WHERE "paymentIntentId"=$1`, [pi]);
    assert.equal(compensation.status, 'REQUESTED', 'solicitado ≠ completado');
    assert.equal((await stockOf(schema, productId, fx.branchA, 'M'))?.stock, 5);

    await inTenantA(() => payments.processCompensations());
    const [done] = await queryRows(`SELECT * FROM "${schema}".payment_compensations WHERE "paymentIntentId"=$1`, [pi]);
    assert.equal(done.status, 'REFUNDED');
    const refund = [...stripe.refunds.values()].find((r) => r.payment_intent === pi)!;
    assert.equal(refund.reverse_transfer, 'true');
    assert.equal(refund.refund_application_fee, 'true');
    assert.equal((await orderRow(orderId)).paymentStatus, 'REEMBOLSADO');

    // Resultado incierto: `processing` conserva la reserva durante un plazo documentado
    const second = await orderFor(api);
    const secondPi = (await createIntent(api, second.orderId)).body.data.paymentIntentId;
    stripe.setStatus(secondPi, 'processing');
    await queryRows(`UPDATE "${schema}".orders SET "paymentExpiresAt" = now() - interval '1 minute' WHERE id=$1`, [second.orderId]);
    await inTenantA(() => maintenance.resolveExpiredOrders());
    const held = await orderRow(second.orderId);
    assert.equal(held.status, 'PENDIENTE');
    assert.ok(new Date(held.paymentExpiresAt).getTime() > Date.now());
    assert.equal((await stockOf(schema, second.productId, fx.branchA, 'M'))?.stock, 4);

    // Proveedor caído: tampoco se libera
    const third = await orderFor(api);
    await createIntent(api, third.orderId);
    await queryRows(`UPDATE "${schema}".orders SET "paymentExpiresAt" = now() - interval '1 minute' WHERE id=$1`, [third.orderId]);
    stripe.unavailable = true;
    await inTenantA(() => maintenance.resolveExpiredOrders());
    stripe.unavailable = false;
    assert.equal((await orderRow(third.orderId)).status, 'PENDIENTE');

    // Carrera real: el pago se confirma mientras la expiración mira al proveedor. Gana una sola transición
    const fourth = await orderFor(api);
    const fourthPi = (await createIntent(api, fourth.orderId)).body.data.paymentIntentId;
    await queryRows(`UPDATE "${schema}".orders SET "paymentExpiresAt" = now() - interval '1 minute' WHERE id=$1`, [fourth.orderId]);
    setFailpoint('expiry.afterProviderCheck', async () => {
      clearFailpoints();
      await inTenantA(async () => {
        stripe.setStatus(fourthPi, 'succeeded');
        await sendWebhook(api, stripe.signedEvent('payment_intent.succeeded', stripe.intents.get(fourthPi)!));
      });
    });
    await inTenantA(() => maintenance.resolveExpiredOrders());
    const raced = await orderRow(fourth.orderId);
    const movements = await count(schema, 'inventory_movements', `"refId"=$1 AND reason='ORDER_EXPIRED'`, [fourth.orderId]);
    assert.ok(
      (raced.status === 'PROCESANDO' && movements === 0) || (raced.status === 'CANCELADO' && movements === 1),
      `estado ${raced.status}, movimientos ${movements}`,
    );
    await assertConservation(schema, fourth.productId, raced.status === 'PROCESANDO' ? 5 : 5);
  });

  it('P06: doble cancelación y reintento de reembolso', async () => {
    const { api } = await buyer();
    const { orderId, productId } = await orderFor(api);
    await createIntent(api, orderId);
    const results = await Promise.all(Array.from({ length: 5 }, () => api.call('DELETE', `/orders/${orderId}`)));
    assert.equal(results.filter((r) => r.status === 200).length, 1, JSON.stringify(results.map((r) => r.status)));
    assert.equal((await stockOf(schema, productId, fx.branchA, 'M'))?.stock, 5);
    assert.equal(await count(schema, 'inventory_movements', `"refId"=$1 AND reason='ORDER_CANCELLED'`, [orderId]), 1);
    await assertConservation(schema, productId, 5);

    // Cancelación interrumpida: la intención persiste y el barrido la completa, sin reponer dos veces
    const second = await orderFor(api);
    await createIntent(api, second.orderId);
    setFailpoint('orders.cancel.afterIntent', () => {
      clearFailpoints();
      throw new Error('crash simulado');
    });
    assert.equal((await api.call('DELETE', `/orders/${second.orderId}`)).status, 500);
    assert.ok((await orderRow(second.orderId)).cancelRequestedAt);
    await inTenantA(() => maintenance.resolveExpiredOrders());
    assert.equal((await orderRow(second.orderId)).status, 'CANCELADO');
    assert.equal((await stockOf(schema, second.productId, fx.branchA, 'M'))?.stock, 5);

    // Reembolso repetido: misma clave, una sola devolución en el proveedor
    const third = await orderFor(api);
    const pi = (await createIntent(api, third.orderId)).body.data.paymentIntentId;
    assert.equal((await api.call('DELETE', `/orders/${third.orderId}`)).status, 200);
    stripe.setStatus(pi, 'succeeded');
    await sendWebhook(api, stripe.signedEvent('payment_intent.succeeded', stripe.intents.get(pi)!));
    stripe.unavailable = true;
    await inTenantA(() => payments.processCompensations());
    stripe.unavailable = false;
    assert.equal((await queryRows(`SELECT status FROM "${schema}".payment_compensations WHERE "paymentIntentId"=$1`, [pi]))[0].status, 'REQUESTED');
    await inTenantA(() => payments.processCompensations());
    await inTenantA(() => payments.processCompensations());
    assert.equal([...stripe.refunds.values()].filter((r) => r.payment_intent === pi).length, 1);
    assert.equal(await count(schema, 'inventory_movements', `"refId"=$1 AND reason='ORDER_CANCELLED'`, [third.orderId]), 1);

    // Cancelar con el pago ya confirmado en el proveedor no cancela: lo liquida
    const fourth = await orderFor(api);
    const paidPi = (await createIntent(api, fourth.orderId)).body.data.paymentIntentId;
    stripe.setStatus(paidPi, 'succeeded');
    const refused = await api.call('DELETE', `/orders/${fourth.orderId}`);
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, 'ORDER_ALREADY_PAID');
    assert.equal((await orderRow(fourth.orderId)).paymentStatus, 'COMPLETADO');
  });

  it('P07: PI ajeno, importe o moneda incorrectos: rechazo y auditoría', async () => {
    const [a, b] = [await buyer(), await buyer()];
    const orderA = await orderFor(a.api);
    const orderB = await orderFor(b.api);
    const piA = (await createIntent(a.api, orderA.orderId)).body.data.paymentIntentId;
    const piB = (await createIntent(b.api, orderB.orderId)).body.data.paymentIntentId;
    stripe.setStatus(piB, 'succeeded');

    // PI pagado de otra orden/usuario: no paga esta orden
    const foreign = await a.api.call('POST', '/payments/confirm', { body: { orderId: orderA.orderId, paymentIntentId: piB } });
    assert.equal(foreign.status, 409);
    assert.equal(foreign.body.code, 'PAYMENT_MISMATCH');
    assert.equal((await orderRow(orderA.orderId)).paymentStatus, 'PENDIENTE');
    // Orden ajena
    const notMine = await a.api.call('POST', '/payments/confirm', { body: { orderId: orderB.orderId, paymentIntentId: piB } });
    assert.equal(notMine.status, 404);
    assert.equal((await createIntent(a.api, orderB.orderId)).status, 404);

    // Importe alterado
    const tampered = stripe.setStatus(piA, 'succeeded');
    tampered.amount = 1;
    const wrongAmount = await a.api.call('POST', '/payments/confirm', { body: { orderId: orderA.orderId, paymentIntentId: piA } });
    assert.equal(wrongAmount.body.code, 'PAYMENT_MISMATCH');
    tampered.amount = 10000;
    tampered.currency = 'eur';
    await sendWebhook(a.api, stripe.signedEvent('payment_intent.succeeded', tampered));
    assert.equal((await orderRow(orderA.orderId)).paymentStatus, 'PENDIENTE');
    tampered.currency = 'usd';
    // Destino y modo
    tampered.transfer_data = { destination: 'acct_beta' };
    assert.equal((await a.api.call('POST', '/payments/confirm', { body: { orderId: orderA.orderId, paymentIntentId: piA } })).body.code, 'PAYMENT_MISMATCH');
    tampered.transfer_data = { destination: 'acct_alpha' };
    tampered.livemode = true;
    assert.equal((await a.api.call('POST', '/payments/confirm', { body: { orderId: orderA.orderId, paymentIntentId: piA } })).body.code, 'PAYMENT_MISMATCH');
    tampered.livemode = false;
    assert.ok((await count(schema, 'operational_issues', `type='PAYMENT_MISMATCH' AND details->>'paymentIntentId' = $1`, [piA])) >= 1);
    assert.ok((await count(schema, 'operational_issues', `type='PAYMENT_MISMATCH' AND details->>'paymentIntentId' = $1`, [piB])) >= 1);

    // Metadata de otra tienda: el mismo PI no confirma en esta
    const betaFx = await seedTenant(TENANT_B.schemaName);
    const betaUser = await createUser(TENANT_B.schemaName, betaFx);
    const betaApi = await apiFor(app, TENANT_B.tenantId, betaUser);
    const crossTenant = await betaApi.call('POST', '/payments/confirm', { body: { orderId: orderA.orderId, paymentIntentId: piA } });
    assert.equal(crossTenant.status, 404);
    assert.equal((await orderRow(orderA.orderId)).paymentStatus, 'PENDIENTE');

    // Las rutas de pago ya no se pueden leer sin sesión: antes listaban los pagos de toda la tienda
    const anonymous = await apiFor(app, tenant);
    assert.equal((await anonymous.call('GET', '/payments')).status, 401);
    assert.equal((await anonymous.call('GET', `/payments/order/${orderA.orderId}`)).status, 401);
  });

  it('P08: caída después de confirmar en BD y antes de correo/push: el outbox se recupera', async () => {
    const { api } = await buyer();
    const { orderId } = await orderFor(api);
    const pi = (await createIntent(api, orderId)).body.data.paymentIntentId;
    stripe.setStatus(pi, 'succeeded');
    const ok = await api.call('POST', '/payments/confirm', { body: { orderId, paymentIntentId: pi } });
    assert.equal(ok.status, 201);
    assert.equal((await orderRow(orderId)).paymentStatus, 'COMPLETADO');

    const pending = () => count(schema, 'outbox_events', `"dedupeKey" IN ($1,$2) AND status='PENDING'`, [`order-paid-invoice:${orderId}`, `order-paid-push:${orderId}`]);
    assert.equal(await pending(), 2, 'la compra persiste y sus efectos quedan en el outbox');

    // Consumidor cae a mitad: lease vencido, otro consumidor lo retoma
    setFailpoint('outbox.beforeDeliver', () => {
      clearFailpoints();
      throw new Error('crash simulado');
    });
    await inTenantA(() => maintenance.deliverOutbox());
    await queryRows(`UPDATE "${schema}".outbox_events SET "nextAttemptAt" = now() - interval '1 minute', "leaseUntil" = NULL WHERE status='PENDING'`);
    await inTenantA(() => maintenance.deliverOutbox());
    assert.equal(await pending(), 0);
    assert.equal(await count(schema, 'outbox_events', `"dedupeKey"=$1 AND status='DONE'`, [`order-paid-invoice:${orderId}`]), 1);
  });

  it('P09: firma inválida y tienda irresoluble: nada falso, y el evento legítimo se recupera', async () => {
    const { api } = await buyer();
    const { orderId } = await orderFor(api);
    const pi = (await createIntent(api, orderId)).body.data.paymentIntentId;
    const intent = stripe.setStatus(pi, 'succeeded');

    const forged = stripe.signedEvent('payment_intent.succeeded', intent);
    const invalid = await fetch(`${api.baseUrl}/api/v1/payments/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' },
      body: forged.payload,
    });
    assert.equal(invalid.status, 400);
    assert.equal((await orderRow(orderId)).paymentStatus, 'PENDIENTE');
    assert.equal(await count('public', 'provider_event_inbox', 'event_id=$1', [forged.id]), 0);

    // La tienda no se puede resolver: el destino no coincide por un cambio en el plano de control
    await queryRows(`UPDATE public.tenants SET stripe_account_id = 'acct_temp' WHERE id=$1`, [tenant]);
    const event = stripe.signedEvent('payment_intent.succeeded', intent);
    assert.equal((await sendWebhook(api, event)).status, 200);
    assert.equal((await orderRow(orderId)).paymentStatus, 'PENDIENTE');
    const [row] = await queryRows(`SELECT status FROM public.provider_event_inbox WHERE event_id=$1`, [event.id]);
    assert.equal(row.status, 'UNRESOLVED');

    await queryRows(`UPDATE public.tenants SET stripe_account_id = 'acct_alpha' WHERE id=$1`, [tenant]);
    await queryRows(`UPDATE public.provider_event_inbox SET next_attempt_at = now() - interval '1 minute' WHERE event_id=$1`, [event.id]);
    await payments.sweepInbox();
    const [processed] = await queryRows(`SELECT status FROM public.provider_event_inbox WHERE event_id=$1`, [event.id]);
    assert.equal(processed.status, 'PROCESSED');
    assert.equal((await orderRow(orderId)).paymentStatus, 'COMPLETADO');

    // Crash entre aplicar y marcar procesado: el lease vence, se repite, y no hay doble efecto
    const second = await orderFor(api);
    const secondPi = (await createIntent(api, second.orderId)).body.data.paymentIntentId;
    const secondEvent = stripe.signedEvent('payment_intent.succeeded', stripe.setStatus(secondPi, 'succeeded'));
    setFailpoint('webhook.afterInbox', () => {
      clearFailpoints();
      throw new Error('crash simulado');
    });
    assert.equal((await sendWebhook(api, secondEvent)).status, 500);
    assert.equal((await orderRow(second.orderId)).paymentStatus, 'PENDIENTE');
    await payments.sweepInbox();
    assert.equal((await orderRow(second.orderId)).paymentStatus, 'COMPLETADO');
    assert.equal(await count(schema, 'outbox_events', `"dedupeKey"=$1`, [`order-paid-invoice:${second.orderId}`]), 1);
  });

  it('P10: aprobación doble y aprobar contra rechazar producen una sola transición', async () => {
    await withSql((c) =>
      c.query(
        `INSERT INTO "${schema}".payment_settings (id,"usdtEnabled","usdtNetwork","usdtWalletAddress","updatedAt") VALUES ('default',true,'TRC20','TXYZ',now())
         ON CONFLICT (id) DO UPDATE SET "usdtEnabled"=true,"usdtNetwork"='TRC20',"usdtWalletAddress"='TXYZ'`,
      ),
    );
    const staffId = await createUser(schema, fx, { permissions: REVIEW_PERMISSIONS });
    const staff = await apiFor(app, tenant, staffId, REVIEW_PERMISSIONS);

    const manualOrder = async (txId: string) => {
      const { id, api } = await buyer();
      const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 5 } });
      const res = await api.createOrder({ key: key(), cartVersion: await api.cartVersion(), paymentMethod: 'USDT', items: [{ productId, quantity: 1, size: 'M' }], branchId: fx.branchA });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      const form = new FormData();
      form.set('method', 'USDT');
      form.set('txId', txId);
      const proof = await fetch(`${api.baseUrl}/api/v1/orders/${res.body.data.id}/payment-proof`, {
        method: 'POST',
        headers: { authorization: `Bearer ${api.token}`, 'x-tenant-id': tenant },
        body: form,
      });
      assert.equal(proof.status, 201, await proof.text());
      return { orderId: res.body.data.id as string, productId, userId: id, api };
    };
    const txId = () => key().replace(/-/g, '') + key().replace(/-/g, '').slice(0, 32);

    const approveTwice = await manualOrder(txId());
    const results = await Promise.all(Array.from({ length: 4 }, () => staff.call('POST', `/orders/admin/${approveTwice.orderId}/payment-proof/approve`)));
    assert.equal(results.filter((r) => r.status === 200).length, 1, JSON.stringify(results.map((r) => r.status)));
    assert.equal((await orderRow(approveTwice.orderId)).paymentStatus, 'COMPLETADO');
    assert.equal(await count(schema, 'outbox_events', `"dedupeKey"=$1`, [`order-paid-invoice:${approveTwice.orderId}`]), 1);

    const race = await manualOrder(txId());
    const [approved, rejected] = await Promise.all([
      staff.call('POST', `/orders/admin/${race.orderId}/payment-proof/approve`),
      staff.call('POST', `/orders/admin/${race.orderId}/payment-proof/reject`),
    ]);
    assert.equal([approved.status, rejected.status].filter((s) => s === 200).length, 1);
    const final = await orderRow(race.orderId);
    const stock = (await stockOf(schema, race.productId, fx.branchA, 'M'))?.stock;
    if (approved.status === 200) {
      assert.deepEqual([final.status, final.paymentStatus, stock], ['PROCESANDO', 'COMPLETADO', 4]);
    } else {
      assert.deepEqual([final.status, final.paymentStatus, stock], ['CANCELADO', 'FALLIDO', 5]);
    }

    // Una referencia verificada no paga otro pedido, ni siquiera a la vez
    const shared = txId();
    await manualOrder(shared);
    const other = await buyer();
    const otherProduct = await createProduct(schema, fx, { [fx.branchA]: { M: 5 } });
    const otherOrder = await other.api.createOrder({ key: key(), cartVersion: await other.api.cartVersion(), paymentMethod: 'USDT', items: [{ productId: otherProduct, quantity: 1, size: 'M' }], branchId: fx.branchA });
    const form = new FormData();
    form.set('method', 'USDT');
    form.set('txId', shared);
    const reused = await fetch(`${other.api.baseUrl}/api/v1/orders/${otherOrder.body.data.id}/payment-proof`, {
      method: 'POST',
      headers: { authorization: `Bearer ${other.api.token}`, 'x-tenant-id': tenant },
      body: form,
    });
    assert.equal(reused.status, 400);

    // Comprobante en revisión no vence
    const inReview = await manualOrder(txId());
    await queryRows(`UPDATE "${schema}".orders SET "paymentExpiresAt" = now() - interval '1 hour' WHERE id=$1`, [inReview.orderId]);
    await inTenantA(() => maintenance.resolveExpiredOrders());
    assert.equal((await orderRow(inReview.orderId)).status, 'PENDIENTE');
  });

  it('P11: QR simulado y tarjeta de prueba quedan bloqueados, sin alternativa', async () => {
    const { api } = await buyer();
    const { orderId, productId } = await orderFor(api);

    assert.equal(simulatedPaymentsEnabled(), false);
    const anonymous = await apiFor(app, tenant);
    for (const res of [
      await anonymous.call('POST', '/payments/qr/generate', { body: { orderId } }),
      await anonymous.call('POST', '/payments/qr/confirm', { body: { orderId, transactionId: 'x' } }),
      await anonymous.call('GET', `/payments/qr/status/${orderId}`),
    ]) {
      assert.equal(res.status, 403);
      assert.equal(res.body.code, 'PAYMENT_SIMULATION_DISABLED');
    }
    const byScan = await fetch(`${api.baseUrl}/api/v1/payments/qr-confirm/${orderId}`, { headers: { 'x-tenant-id': tenant } });
    assert.ok(byScan.status >= 400);
    // La ruta alternativa de /confirm con prefijo QR tampoco marca nada
    const viaConfirm = await api.call('POST', '/payments/confirm', { body: { orderId, paymentIntentId: `QR_${orderId}` } });
    assert.equal(viaConfirm.status, 409);
    assert.equal(viaConfirm.body.code, 'PAYMENT_PENDING');
    // Ni al crear la orden
    const qrOrder = await api.createOrder({ key: key(), cartVersion: await api.cartVersion(), paymentMethod: 'QR', items: [{ productId, quantity: 1, size: 'M' }], branchId: fx.branchA });
    assert.equal(qrOrder.status, 403);
    assert.equal((await orderRow(orderId)).paymentStatus, 'PENDIENTE');

    // Tarjeta de prueba: un PI sin pagar no se autoconfirma, aunque la clave sea sk_test_
    assert.ok(process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_'));
    const confirmsBefore = stripe.confirmCalls;
    const pi = (await createIntent(api, orderId)).body.data.paymentIntentId;
    const unpaid = await api.call('POST', '/payments/confirm', { body: { orderId, paymentIntentId: pi } });
    assert.equal(unpaid.status, 400);
    assert.equal(stripe.intents.get(pi)!.status, 'requires_payment_method');
    assert.equal(stripe.confirmCalls, confirmsBefore, 'la API no pidió a Stripe confirmar con la tarjeta de prueba');
    assert.notEqual((await orderRow(orderId)).paymentStatus, 'COMPLETADO');

    // Configuración productiva: ni con el opt-in se activa
    const saved = { env: process.env.NODE_ENV, flag: process.env.ALLOW_SIMULATED_PAYMENTS };
    process.env.ALLOW_SIMULATED_PAYMENTS = 'true';
    process.env.NODE_ENV = 'production';
    assert.equal(simulatedPaymentsEnabled(), false);
    process.env.NODE_ENV = 'test';
    assert.equal(simulatedPaymentsEnabled(), true);
    process.env.NODE_ENV = saved.env;
    delete process.env.ALLOW_SIMULATED_PAYMENTS;
  });

  it('P11b: la autoconfirmación de demo es una simulación explícita, imposible en producción', async () => {
    const saved = { env: process.env.NODE_ENV, flag: process.env.ALLOW_SIMULATED_PAYMENTS };
    try {
      // Con el opt-in fuera de producción: se confirma con la tarjeta de prueba y el cobro entra por
      // reconcileIntent, como cualquier PaymentIntent que Stripe informa como succeeded
      process.env.ALLOW_SIMULATED_PAYMENTS = 'true';
      const { api } = await buyer();
      const simulated = await orderFor(api);
      const pi = (await createIntent(api, simulated.orderId)).body.data.paymentIntentId;
      const confirmsBefore = stripe.confirmCalls;
      const ok = await api.call('POST', '/payments/confirm', { body: { orderId: simulated.orderId, paymentIntentId: pi } });
      assert.equal(ok.status, 201, JSON.stringify(ok.body));
      assert.equal(stripe.confirmCalls, confirmsBefore + 1);
      assert.equal((await orderRow(simulated.orderId)).paymentStatus, 'COMPLETADO');

      // Producción con el mismo opt-in: no hay simulación y el PI sin pagar sigue sin pagar
      process.env.NODE_ENV = 'production';
      const real = await orderFor(api);
      const realPi = (await createIntent(api, real.orderId)).body.data.paymentIntentId;
      const blocked = await api.call('POST', '/payments/confirm', { body: { orderId: real.orderId, paymentIntentId: realPi } });
      assert.equal(blocked.status, 400);
      assert.equal(stripe.confirmCalls, confirmsBefore + 1, 'en producción no se confirma nada en nombre del cliente');
      assert.equal(stripe.intents.get(realPi)!.status, 'requires_payment_method');
      assert.notEqual((await orderRow(real.orderId)).paymentStatus, 'COMPLETADO');
    } finally {
      process.env.NODE_ENV = saved.env;
      if (saved.flag === undefined) delete process.env.ALLOW_SIMULATED_PAYMENTS;
      else process.env.ALLOW_SIMULATED_PAYMENTS = saved.flag;
    }
  });

  it('Unidades menores: decimales según la moneda, sin punto flotante', () => {
    assert.equal(toMinorUnits('19.99', 'usd'), 1999);
    assert.equal(toMinorUnits('1.10', 'usd'), 110);
    assert.equal(toMinorUnits('1000', 'jpy'), 1000);
    assert.equal(toMinorUnits('1.234', 'kwd'), 1234);
    assert.equal(toMinorUnits('4.35', 'usd'), 435);
  });

  it('M01: mismos IDs y claves en dos tiendas, con barridos simultáneos: aislamiento completo', async () => {
    const betaSchema = TENANT_B.schemaName;
    const betaFx = await seedTenant(betaSchema);
    const userA = await createUser(schema, fx);
    const userB = await createUser(betaSchema, betaFx);
    const productA = await createProduct(schema, fx, { [fx.branchA]: { M: 3 } });
    const productB = await createProduct(betaSchema, betaFx, { [betaFx.branchA]: { M: 7 } });
    const apiA = await apiFor(app, tenant, userA);
    const apiB = await apiFor(app, TENANT_B.tenantId, userB);
    const sharedKey = key();

    const a = await apiA.createOrder({ key: sharedKey, cartVersion: await apiA.cartVersion(), items: [{ productId: productA, quantity: 1, size: 'M' }], branchId: fx.branchA });
    const b = await apiB.createOrder({ key: sharedKey, cartVersion: await apiB.cartVersion(), items: [{ productId: productB, quantity: 1, size: 'M' }], branchId: betaFx.branchA });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.notEqual(a.body.data.id, b.body.data.id);
    assert.equal((await stockOf(schema, productA, fx.branchA, 'M'))?.stock, 2);
    assert.equal((await stockOf(betaSchema, productB, betaFx.branchA, 'M'))?.stock, 6);

    // Token de una tienda contra otra: el id no existe allí
    const crossed = apiA.as(apiA.token!, TENANT_B.tenantId);
    assert.ok([401, 403, 404].includes((await crossed.call('GET', `/orders/attempts/${sharedKey}`)).status));

    // El PaymentIntent de cada tienda usa su cuenta y su clave
    const piA = (await createIntent(apiA, a.body.data.id)).body.data.paymentIntentId;
    const piB = (await createIntent(apiB, b.body.data.id)).body.data.paymentIntentId;
    assert.equal(stripe.intents.get(piA)!.transfer_data.destination, 'acct_alpha');
    assert.equal(stripe.intents.get(piB)!.transfer_data.destination, 'acct_beta');

    // Crons simultáneos, cada uno en su tienda
    await queryRows(`UPDATE "${schema}".orders SET "paymentExpiresAt" = now() - interval '1 minute' WHERE id=$1`, [a.body.data.id]);
    await Promise.all([inTenantA(() => maintenance.resolveExpiredOrders()), inTenantB(() => maintenance.resolveExpiredOrders())]);
    assert.equal((await orderRow(a.body.data.id)).status, 'CANCELADO');
    const [beta] = await queryRows(`SELECT status FROM "${betaSchema}".orders WHERE id=$1`, [b.body.data.id]);
    assert.equal(beta.status, 'PENDIENTE');
    assert.equal(await count(betaSchema, 'orders', 'id=$1', [a.body.data.id]), 0);
  });

  it('Métricas operativas por tienda exigen permiso', async () => {
    const id = await createUser(schema, fx, { permissions: ['VIEW_REPORTS'] });
    const staff = await apiFor(app, tenant, id, ['VIEW_REPORTS']);
    const res = await staff.call('GET', '/checkout-ops/metrics');
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.data.aggregateDrift, 'number');
    const { api } = await buyer();
    assert.equal((await api.call('GET', '/checkout-ops/metrics')).status, 403);
  });
});
