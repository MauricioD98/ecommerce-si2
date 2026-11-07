import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { FakeStripe } from './support/fake-stripe';
import { simulatedPaymentsEnabled } from '../../src/common/checkout/checkout-policy';
import { Api, TENANT_A, TENANT_B, apiFor, bootApp, count, createProduct, createUser, key, queryRows, seedTenant, type Fixture } from './support/world';

// La tarjeta de una tienda SIEMPRE cobra con su propia cuenta Stripe Connect habilitada como destino.
// Sin ella: la API rechaza el cobro y el checkout no la ofrece, con cualquier clave (sk_test_ incluida),
// para cualquier tienda (la legacy incluida) y aunque la simulación de desarrollo esté encendida.
describe('Stripe Connect: destino obligatorio de la tienda', () => {
  let app: INestApplication;
  let stripe: FakeStripe;
  const fx: Record<string, Fixture> = {};
  const saved = {
    env: process.env.NODE_ENV,
    simulated: process.env.ALLOW_SIMULATED_PAYMENTS,
    legacy: process.env.LEGACY_TENANT_ID,
    currency: process.env.PAYMENT_CURRENCY,
  };

  const setConnect = (tenantId: string, account: string | null, enabled: boolean, feeBps = 250) =>
    queryRows(`UPDATE public.tenants SET stripe_account_id=$2, stripe_charges_enabled=$3, platform_fee_bps=$4 WHERE id=$1`, [tenantId, account, enabled, feeBps]);
  const restoreConnect = async () => {
    await setConnect(TENANT_A.tenantId, 'acct_alpha', true);
    await setConnect(TENANT_B.tenantId, 'acct_beta', true);
  };

  const buyer = async (t: typeof TENANT_A) => {
    const id = await createUser(t.schemaName, fx[t.tenantId]);
    return { id, api: await apiFor(app, t.tenantId, id) };
  };

  // Orden PICKUP de 100.00 (o del precio dado) con la reserva consumida
  const orderFor = async (t: typeof TENANT_A, api: Api, price = 100) => {
    const f = fx[t.tenantId];
    const productId = await createProduct(t.schemaName, f, { [f.branchA]: { M: 5 } }, price);
    await api.addToCart(productId, 1, 'M', f.branchA);
    const res = await api.createOrder({ key: key(), cartVersion: await api.cartVersion(), items: [{ productId, quantity: 1, size: 'M' }], branchId: f.branchA });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.data.id as string;
  };

  const createIntent = (api: Api, orderId: string, extra: Record<string, unknown> = {}) =>
    api.call('POST', '/payments/create-intent', { body: { orderId, ...extra } });
  const cardOffered = async (api: Api) => {
    const availability = await api.call('GET', '/payments/connect/availability');
    const options = await api.call('GET', '/store/payment-options');
    assert.equal(availability.status, 200, JSON.stringify(availability.body));
    assert.equal(options.status, 200, JSON.stringify(options.body));
    return { availability: availability.body.data.cardEnabled as boolean, options: options.body.data.card as boolean, simulatedCard: options.body.data.simulatedCard as boolean };
  };
  const attemptsOf = (t: typeof TENANT_A, orderId: string) =>
    queryRows(`SELECT * FROM "${t.schemaName}".payment_attempts WHERE "orderId"=$1 ORDER BY "attemptNumber"`, [orderId]);
  const orderRow = async (t: typeof TENANT_A, orderId: string) => (await queryRows(`SELECT * FROM "${t.schemaName}".orders WHERE id=$1`, [orderId]))[0];

  before(async () => {
    stripe = new FakeStripe();
    process.env.STRIPE_API_BASE = await stripe.start();
    app = await bootApp();
    fx[TENANT_A.tenantId] = await seedTenant(TENANT_A.schemaName);
    fx[TENANT_B.tenantId] = await seedTenant(TENANT_B.schemaName);
  });
  after(async () => {
    await restoreConnect();
    await app.close();
    await stripe.stop();
  });
  afterEach(async () => {
    process.env.NODE_ENV = saved.env;
    process.env.ALLOW_SIMULATED_PAYMENTS = saved.simulated ?? 'false';
    process.env.LEGACY_TENANT_ID = saved.legacy ?? '';
    process.env.PAYMENT_CURRENCY = saved.currency ?? 'usd';
    await restoreConnect();
  });

  it('K01: tienda sin cuenta Connect: tarjeta no ofrecida y creación del pago rechazada', async () => {
    const { api } = await buyer(TENANT_A);
    const orderId = await orderFor(TENANT_A, api);
    await setConnect(TENANT_A.tenantId, null, false);

    assert.deepEqual(await cardOffered(api), { availability: false, options: false, simulatedCard: false });
    const createsBefore = stripe.createCalls;
    const res = await createIntent(api, orderId);
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(stripe.createCalls, createsBefore, 'no se llamó a Stripe');
    assert.equal((await attemptsOf(TENANT_A, orderId)).length, 0, 'ni siquiera se abrió un intento');
    assert.equal((await orderRow(TENANT_A, orderId)).paymentStatus, 'PENDIENTE');
  });

  it('K02: cuenta conectada pero no habilitada: rechazada igual', async () => {
    const { api } = await buyer(TENANT_A);
    const orderId = await orderFor(TENANT_A, api);
    await setConnect(TENANT_A.tenantId, 'acct_alpha', false);

    assert.deepEqual(await cardOffered(api), { availability: false, options: false, simulatedCard: false });
    const createsBefore = stripe.createCalls;
    const res = await createIntent(api, orderId);
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(stripe.createCalls, createsBefore);
    assert.equal((await attemptsOf(TENANT_A, orderId)).length, 0);
  });

  it('K03: cuenta habilitada: destino de la tienda, monto del servidor y comisión configurada', async () => {
    await setConnect(TENANT_A.tenantId, 'acct_alpha', true, 500);
    const { api } = await buyer(TENANT_A);
    const orderId = await orderFor(TENANT_A, api, 80);
    assert.deepEqual(await cardOffered(api), { availability: true, options: true, simulatedCard: false });

    // El cliente intenta fijar otro importe, moneda y destino: se ignoran
    const res = await createIntent(api, orderId, { amount: 1, currency: 'jpy', destination: 'acct_beta', transfer_data: { destination: 'acct_beta' } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const intent = stripe.intents.get(res.body.data.paymentIntentId)!;
    assert.equal(intent.amount, 8000);
    assert.equal(intent.currency, 'usd');
    assert.equal(intent.transfer_data.destination, 'acct_alpha');
    assert.equal(intent.on_behalf_of, 'acct_alpha');
    assert.equal(intent.application_fee_amount, 400, '5 % de 80.00');
    assert.equal(intent.metadata.tenantId, TENANT_A.tenantId);
    const [attempt] = await attemptsOf(TENANT_A, orderId);
    assert.equal(attempt.destinationAccount, 'acct_alpha');
    assert.equal(attempt.amountMinor, 8000);
    assert.equal(attempt.feeAmountMinor, 400);
  });

  it('K04: dos tiendas: ninguna usa la cuenta conectada de la otra', async () => {
    const a = await buyer(TENANT_A);
    const b = await buyer(TENANT_B);
    const orderA = await orderFor(TENANT_A, a.api);
    const orderB = await orderFor(TENANT_B, b.api);

    // B sin Connect mientras A sí lo tiene: B no cobra (y menos con la cuenta de A)
    await setConnect(TENANT_B.tenantId, null, false);
    assert.equal((await cardOffered(b.api)).options, false);
    assert.equal((await cardOffered(a.api)).options, true);
    assert.equal((await createIntent(b.api, orderB)).status, 400);
    assert.equal((await attemptsOf(TENANT_B, orderB)).length, 0);

    // El token de A con el header de B no paga la orden de A con la cuenta de B
    const crossed = a.api.as(a.api.token!, TENANT_B.tenantId);
    assert.ok([400, 401, 403, 404].includes((await createIntent(crossed, orderA)).status));
    await setConnect(TENANT_B.tenantId, 'acct_beta', true);
    assert.ok([401, 403, 404].includes((await createIntent(crossed, orderA)).status));

    const piA = (await createIntent(a.api, orderA)).body.data.paymentIntentId;
    const piB = (await createIntent(b.api, orderB)).body.data.paymentIntentId;
    assert.equal(stripe.intents.get(piA)!.transfer_data.destination, 'acct_alpha');
    assert.equal(stripe.intents.get(piB)!.transfer_data.destination, 'acct_beta');

    // Un PaymentIntent de A que llega con el destino de B no marca nada como pagado
    const forged = stripe.intents.get(piA)!;
    forged.transfer_data = { destination: 'acct_beta' };
    forged.status = 'succeeded';
    const confirm = await a.api.call('POST', '/payments/confirm', { body: { orderId: orderA, paymentIntentId: piA } });
    assert.equal(confirm.status, 409, JSON.stringify(confirm.body));
    assert.equal(confirm.body.code, 'PAYMENT_MISMATCH');
    assert.notEqual((await orderRow(TENANT_A, orderA)).paymentStatus, 'COMPLETADO');
  });

  it('K05: una clave sk_test_ (ni la tienda legacy, ni la simulación encendida) no salta la cuenta conectada', async () => {
    assert.ok(process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_'));
    const { api } = await buyer(TENANT_A);
    const orderId = await orderFor(TENANT_A, api);
    await setConnect(TENANT_A.tenantId, null, false);

    // Como legacy: antes cobraba en la cuenta central con cualquier clave, incluida sk_live_
    process.env.LEGACY_TENANT_ID = TENANT_A.tenantId;
    process.env.ALLOW_SIMULATED_PAYMENTS = 'true';
    assert.equal(simulatedPaymentsEnabled(), true);

    assert.deepEqual(await cardOffered(api), { availability: false, options: false, simulatedCard: false });
    const createsBefore = stripe.createCalls;
    const res = await createIntent(api, orderId);
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(stripe.createCalls, createsBefore);
    assert.equal([...stripe.intents.values()].filter((i) => i.metadata.orderId === orderId).length, 0, 'ningún cobro a la cuenta central');
  });

  it('K06: un intento abierto sin destino (comportamiento anterior) se retira y no se vuelve a ofrecer', async () => {
    const { api } = await buyer(TENANT_A);
    const orderId = await orderFor(TENANT_A, api);
    const oldPi = (await createIntent(api, orderId)).body.data.paymentIntentId as string;
    // Se reconstruye cómo quedaba con el fallback: PI sin transfer_data e intento sin destino
    const old = stripe.intents.get(oldPi)!;
    old.transfer_data = null;
    old.on_behalf_of = null;
    old.application_fee_amount = null;
    await queryRows(`UPDATE "${TENANT_A.schemaName}".payment_attempts SET "destinationAccount"=NULL, "feeAmountMinor"=NULL WHERE "stripePaymentIntentId"=$1`, [oldPi]);

    const res = await createIntent(api, orderId);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.notEqual(res.body.data.paymentIntentId, oldPi);
    assert.equal(stripe.intents.get(oldPi)!.status, 'canceled', 'el client_secret viejo ya no cobra a la cuenta central');
    assert.equal(stripe.intents.get(res.body.data.paymentIntentId)!.transfer_data.destination, 'acct_alpha');
    const attempts = await attemptsOf(TENANT_A, orderId);
    assert.deepEqual(attempts.map((x) => [x.status, x.destinationAccount]), [['CANCELED', null], ['OPEN', 'acct_alpha']]);
  });

  it('K07: un cobro anterior sin destino que el cliente ya pagó se respeta, una vez, y deja una anomalía', async () => {
    const { api } = await buyer(TENANT_A);
    const orderId = await orderFor(TENANT_A, api);
    const oldPi = (await createIntent(api, orderId)).body.data.paymentIntentId as string;
    const old = stripe.intents.get(oldPi)!;
    old.transfer_data = null;
    old.on_behalf_of = null;
    old.application_fee_amount = null;
    await queryRows(`UPDATE "${TENANT_A.schemaName}".payment_attempts SET "destinationAccount"=NULL, "feeAmountMinor"=NULL WHERE "stripePaymentIntentId"=$1`, [oldPi]);
    old.status = 'succeeded';

    const event = stripe.signedEvent('payment_intent.succeeded', old);
    for (let i = 0; i < 2; i += 1) {
      const res = await fetch(`${api.baseUrl}/api/v1/payments/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'stripe-signature': event.signature },
        body: event.payload,
      });
      assert.equal(res.status, 200);
    }
    assert.equal((await orderRow(TENANT_A, orderId)).paymentStatus, 'COMPLETADO');
    assert.equal(await count(TENANT_A.schemaName, 'operational_issues', `"dedupeKey"=$1`, [`no-destination:${oldPi}`]), 1);
    // Pagado: no se abre otro cobro
    const again = await createIntent(api, orderId);
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'ORDER_ALREADY_PAID');
  });

  it('K10: onboarding: un error guardado por Stripe (Connect sin activar) no bloquea el reintento ni duplica cuentas', async () => {
    await setConnect(TENANT_A.tenantId, null, false);
    const ownerId = await createUser(TENANT_A.schemaName, fx[TENANT_A.tenantId], { permissions: ['MANAGE_PAYMENTS'] });
    const owner = await apiFor(app, TENANT_A.tenantId, ownerId, ['MANAGE_PAYMENTS']);
    const onboarding = () => owner.call('POST', '/admin/settings/payments/stripe/onboarding');
    const accountOf = async () =>
      (await queryRows(`SELECT stripe_account_id FROM public.tenants WHERE id=$1`, [TENANT_A.tenantId]))[0].stripe_account_id as string | null;
    try {
      // 1. La plataforma todavía no activó Connect: se explica, y Stripe guarda ese error con la clave
      stripe.connectEnabled = false;
      const blocked = await onboarding();
      assert.equal(blocked.status, 400);
      assert.match(JSON.stringify(blocked.body), /Connect/);
      assert.equal(await accountOf(), null);

      // 2. Connect activado: Stripe repetiría el error guardado, pero se reintenta con otra clave
      stripe.connectEnabled = true;
      const createsBefore = stripe.accountCreateCalls;
      const ok = await onboarding();
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
      assert.match(ok.body.data.url, /^https:\/\/connect\.stripe\.test\/setup\/acct_/);
      const accountId = await accountOf();
      assert.ok(accountId?.startsWith('acct_'));
      assert.equal(stripe.accounts.get(accountId!)!.metadata.tenantId, TENANT_A.tenantId);
      assert.equal(stripe.accountCreateCalls, createsBefore + 2, 'el repetido y un único reintento');

      // 3. Continuar el onboarding reutiliza la cuenta: ninguna otra creación, y sigue sin habilitar
      const again = await onboarding();
      assert.equal(again.status, 200);
      assert.equal(stripe.accountCreateCalls, createsBefore + 2);
      assert.equal(await accountOf(), accountId);
      assert.equal((await cardOffered(owner)).options, false, 'sin completar el onboarding no hay tarjeta');
    } finally {
      stripe.connectEnabled = true;
    }
  });

  it('K09: la moneda del cobro es la que informa el checkout; por defecto BOB (precios en Bs)', async () => {
    const { api } = await buyer(TENANT_A);

    // Sin PAYMENT_CURRENCY: bolivianos, en centavos
    delete process.env.PAYMENT_CURRENCY;
    const options = await api.call('GET', '/store/payment-options');
    assert.equal(options.body.data.currency, 'bob');
    const orderId = await orderFor(TENANT_A, api, 149.9);
    const res = await createIntent(api, orderId, { currency: 'usd' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const intent = stripe.intents.get(res.body.data.paymentIntentId)!;
    assert.equal(intent.currency, 'bob', 'la moneda del cliente se ignora');
    assert.equal(intent.amount, 14990);
    assert.equal((await attemptsOf(TENANT_A, orderId))[0].currency, 'bob');

    // Configurada explícitamente: el checkout recibe la misma que se envía a Stripe
    process.env.PAYMENT_CURRENCY = 'USD';
    assert.equal((await api.call('GET', '/store/payment-options')).body.data.currency, 'usd');
    const other = await orderFor(TENANT_A, api);
    const usdPi = (await createIntent(api, other)).body.data.paymentIntentId;
    assert.equal(stripe.intents.get(usdPi)!.currency, 'usd');
  });

  it('K08: la simulación de desarrollo solo existe con su opt-in, sobre Connect, fuera de producción, y se declara', async () => {
    const { api } = await buyer(TENANT_A);

    // Sin opt-in: no se ofrece ni confirma nada en nombre del cliente
    assert.equal((await cardOffered(api)).simulatedCard, false);
    const plain = await orderFor(TENANT_A, api);
    const plainPi = (await createIntent(api, plain)).body.data.paymentIntentId;
    assert.equal((await api.call('POST', '/payments/confirm', { body: { orderId: plain, paymentIntentId: plainPi } })).status, 400);

    // Con opt-in fuera de producción: simulación declarada, sobre el PaymentIntent con destino de la tienda
    process.env.ALLOW_SIMULATED_PAYMENTS = 'true';
    assert.equal((await cardOffered(api)).simulatedCard, true);
    const sim = await orderFor(TENANT_A, api);
    const simPi = (await createIntent(api, sim)).body.data.paymentIntentId;
    const ok = await api.call('POST', '/payments/confirm', { body: { orderId: sim, paymentIntentId: simPi } });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.simulated, true);
    assert.match(ok.body.message, /simulated/i);
    assert.equal(stripe.intents.get(simPi)!.transfer_data.destination, 'acct_alpha');
    assert.equal((await orderRow(TENANT_A, sim)).paymentStatus, 'COMPLETADO');

    // Una confirmación real (el cliente pagó en Stripe) no se declara simulada
    const real = await orderFor(TENANT_A, api);
    const realPi = (await createIntent(api, real)).body.data.paymentIntentId;
    stripe.setStatus(realPi, 'succeeded');
    const realOk = await api.call('POST', '/payments/confirm', { body: { orderId: real, paymentIntentId: realPi } });
    assert.equal(realOk.status, 201);
    assert.equal(realOk.body.simulated, undefined);

    // Producción con el mismo opt-in: bloqueada
    process.env.NODE_ENV = 'production';
    assert.equal(simulatedPaymentsEnabled(), false);
    assert.equal((await cardOffered(api)).simulatedCard, false);
    const prod = await orderFor(TENANT_A, api);
    const prodPi = (await createIntent(api, prod)).body.data.paymentIntentId;
    const confirmsBefore = stripe.confirmCalls;
    assert.equal((await api.call('POST', '/payments/confirm', { body: { orderId: prod, paymentIntentId: prodPi } })).status, 400);
    assert.equal(stripe.confirmCalls, confirmsBefore);
    assert.notEqual((await orderRow(TENANT_A, prod)).paymentStatus, 'COMPLETADO');
  });
});
