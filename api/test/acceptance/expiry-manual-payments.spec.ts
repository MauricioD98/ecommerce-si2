import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { FakeStripe } from './support/fake-stripe';
import { MANUAL_PAYMENT_METHODS, orderPaymentTtlMs } from '../../src/common/checkout/checkout-policy';
import { CheckoutMaintenanceService } from '../../src/modules/payments/checkout-maintenance.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  Api,
  TENANT_A,
  apiFor,
  bootApp,
  count,
  createProduct,
  createUser,
  inTenantA,
  key,
  queryRows,
  seedTenant,
  stockOf,
  withSql,
  type Fixture,
} from './support/world';

const schema = TENANT_A.schemaName;
const tenant = TENANT_A.tenantId;
const HOUR = 60 * 60 * 1000;
const TTL_ENV = ['ORDER_TTL_MANUAL_MS', 'ORDER_TTL_CARD_MS'] as const;

// El barrido toma 100 órdenes vencidas por pasada: este archivo corre primero (orden alfabético, base recién
// creada), así que las únicas órdenes de la tienda son las suyas.
describe('Vencimiento de pedidos por medio de pago (WALLET, BANK_QR, USDT y tarjeta)', () => {
  let app: INestApplication;
  let fx: Fixture;
  let stripe: FakeStripe;
  let maintenance: CheckoutMaintenanceService;
  let prisma: PrismaService;
  let previousPlan: string;
  const savedEnv: Partial<Record<(typeof TTL_ENV)[number], string>> = {};

  const buyer = async () => {
    const id = await createUser(schema, fx);
    return apiFor(app, tenant, id);
  };

  // Pedido PICKUP de una unidad con su stock reservado. t0/t1 acotan el reloj del servidor al crearlo.
  const placeOrder = async (api: Api, paymentMethod?: PaymentMethod) => {
    const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 5 } });
    await api.addToCart(productId, 1, 'M', fx.branchA);
    const t0 = Date.now();
    const res = await api.createOrder({
      key: key(),
      cartVersion: await api.cartVersion(),
      items: [{ productId, quantity: 1, size: 'M' }],
      branchId: fx.branchA,
      ...(paymentMethod ? { paymentMethod } : {}),
    });
    const t1 = Date.now();
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const orderId = res.body.data.id as string;
    const expiresAt = (await order(orderId)).paymentExpiresAt!.getTime();
    return { orderId, productId, t0, t1, expiresAt };
  };

  // Vía Prisma (no pg crudo): la columna es TIMESTAMP sin zona y pg la leería con la zona local
  const order = (orderId: string) =>
    inTenantA(() => prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true, paymentExpiresAt: true, paymentMethod: true } }));
  const sweep = (now: number) => inTenantA(() => maintenance.resolveExpiredOrders(new Date(now)));
  const stock = async (productId: string) => (await stockOf(schema, productId, fx.branchA, 'M'))?.stock;

  const assertDeadline = (placed: { t0: number; t1: number; expiresAt: number }, ttl: number) => {
    assert.ok(placed.expiresAt >= placed.t0 + ttl && placed.expiresAt <= placed.t1 + ttl, `vence a ${placed.expiresAt - placed.t0} ms, se esperaba ${ttl}`);
  };

  const submitProof = async (api: Api, orderId: string, method: 'WALLET' | 'USDT', txId: string) => {
    const form = new FormData();
    form.set('method', method);
    form.set('txId', txId);
    const res = await fetch(`${api.baseUrl}/api/v1/orders/${orderId}/payment-proof`, {
      method: 'POST',
      headers: { authorization: `Bearer ${api.token}`, 'x-tenant-id': tenant },
      body: form,
    });
    assert.equal(res.status, 201, await res.text());
  };

  before(async () => {
    for (const name of TTL_ENV) {
      savedEnv[name] = process.env[name];
      delete process.env[name];
    }
    // La billetera exige el plan Growth/Pro: se fija antes de arrancar (el middleware cachea la tienda)
    const [tenantRow] = await queryRows(`SELECT plan FROM public.tenants WHERE id=$1`, [tenant]);
    previousPlan = tenantRow.plan;
    await queryRows(`UPDATE public.tenants SET plan='pro' WHERE id=$1`, [tenant]);
    stripe = new FakeStripe();
    process.env.STRIPE_API_BASE = await stripe.start();
    app = await bootApp();
    fx = await seedTenant(schema);
    maintenance = app.get(CheckoutMaintenanceService, { strict: false });
    prisma = app.get(PrismaService, { strict: false });
    await withSql((c) =>
      c.query(
        `INSERT INTO "${schema}".payment_settings (id,"qrEnabled","qrImageType","usdtEnabled","usdtNetwork","usdtWalletAddress","walletEnabled","walletProvider","walletAccount","updatedAt")
         VALUES ('default',true,'image/png',true,'TRC20','TXYZ',true,'Airtm','pagos@alpha.test',now())
         ON CONFLICT (id) DO UPDATE SET "qrEnabled"=true,"qrImageType"='image/png',"usdtEnabled"=true,"usdtNetwork"='TRC20',"usdtWalletAddress"='TXYZ',
           "walletEnabled"=true,"walletProvider"='Airtm',"walletAccount"='pagos@alpha.test'`,
      ),
    );
  });
  after(async () => {
    await app.close();
    await stripe.stop();
    await queryRows(`UPDATE public.tenants SET plan=$2 WHERE id=$1`, [tenant, previousPlan]);
    for (const name of TTL_ENV) {
      if (savedEnv[name] === undefined) delete process.env[name];
      else process.env[name] = savedEnv[name];
    }
  });

  it('E01: política por defecto: los tres medios manuales 24 h, tarjeta y el resto 1 h', () => {
    assert.deepEqual([...MANUAL_PAYMENT_METHODS].sort(), [PaymentMethod.BANK_QR, PaymentMethod.USDT, PaymentMethod.WALLET].sort());
    for (const method of [PaymentMethod.WALLET, PaymentMethod.BANK_QR, PaymentMethod.USDT]) {
      assert.equal(orderPaymentTtlMs(method), 24 * HOUR, method);
    }
    for (const method of [PaymentMethod.STRIPE, PaymentMethod.QR, PaymentMethod.CASH, PaymentMethod.PHYSICAL_CARD]) {
      assert.equal(orderPaymentTtlMs(method), HOUR, method);
    }
  });

  it('E02: TTL configurado por entorno; valores inválidos vuelven al predeterminado', () => {
    try {
      process.env.ORDER_TTL_MANUAL_MS = String(2 * HOUR);
      process.env.ORDER_TTL_CARD_MS = String(5 * 60 * 1000);
      assert.equal(orderPaymentTtlMs(PaymentMethod.WALLET), 2 * HOUR);
      assert.equal(orderPaymentTtlMs(PaymentMethod.BANK_QR), 2 * HOUR);
      assert.equal(orderPaymentTtlMs(PaymentMethod.USDT), 2 * HOUR);
      assert.equal(orderPaymentTtlMs(PaymentMethod.STRIPE), 5 * 60 * 1000);
      for (const invalid of ['0', '-1', 'abc', '']) {
        process.env.ORDER_TTL_MANUAL_MS = invalid;
        process.env.ORDER_TTL_CARD_MS = invalid;
        assert.equal(orderPaymentTtlMs(PaymentMethod.WALLET), 24 * HOUR, `manual con "${invalid}"`);
        assert.equal(orderPaymentTtlMs(PaymentMethod.STRIPE), HOUR, `tarjeta con "${invalid}"`);
      }
    } finally {
      for (const name of TTL_ENV) delete process.env[name];
    }
  });

  it('E03: al crear el pedido se guarda el plazo del medio elegido', async () => {
    const api = await buyer();
    for (const method of [PaymentMethod.WALLET, PaymentMethod.BANK_QR, PaymentMethod.USDT]) {
      const placed = await placeOrder(api, method);
      assertDeadline(placed, 24 * HOUR);
      assert.equal((await order(placed.orderId)).paymentMethod, method);
      assert.equal(await stock(placed.productId), 4, 'stock reservado');
    }
    assertDeadline(await placeOrder(api), HOUR);
  });

  it('E04: billetera no vence a la hora; vence en el límite manual y repone el stock una vez', async () => {
    const api = await buyer();
    const wallet = await placeOrder(api, PaymentMethod.WALLET);
    const card = await placeOrder(api);

    // Una hora y un minuto después: la tarjeta vence, la billetera sigue reservada
    await sweep(wallet.t1 + HOUR + 60_000);
    assert.equal((await order(card.orderId)).status, 'CANCELADO');
    assert.equal(await stock(card.productId), 5);
    assert.equal((await order(wallet.orderId)).status, 'PENDIENTE');
    assert.equal(await stock(wallet.productId), 4);

    // El límite es estricto (`paymentExpiresAt < now`): justo en el plazo todavía no vence
    await sweep(wallet.expiresAt);
    assert.equal((await order(wallet.orderId)).status, 'PENDIENTE');
    assert.equal(await stock(wallet.productId), 4);

    await sweep(wallet.expiresAt + 1);
    const expired = await order(wallet.orderId);
    assert.equal(expired.status, 'CANCELADO');
    assert.equal(expired.paymentExpiresAt, null);
    assert.equal(await stock(wallet.productId), 5);

    // Repetir el barrido no repone dos veces
    await sweep(wallet.expiresAt + HOUR);
    assert.equal(await stock(wallet.productId), 5);
    assert.equal(await count(schema, 'inventory_movements', `"refId"=$1 AND reason='ORDER_EXPIRED'`, [wallet.orderId]), 1);
  });

  it('E05: BANK_QR y USDT vencen con la misma política manual', async () => {
    const api = await buyer();
    const qr = await placeOrder(api, PaymentMethod.BANK_QR);
    const usdt = await placeOrder(api, PaymentMethod.USDT);
    await sweep(Math.max(qr.t1, usdt.t1) + HOUR + 60_000);
    assert.deepEqual([(await order(qr.orderId)).status, (await order(usdt.orderId)).status], ['PENDIENTE', 'PENDIENTE']);
    await sweep(Math.max(qr.expiresAt, usdt.expiresAt) + 1);
    assert.deepEqual([(await order(qr.orderId)).status, (await order(usdt.orderId)).status], ['CANCELADO', 'CANCELADO']);
    assert.deepEqual([await stock(qr.productId), await stock(usdt.productId)], [5, 5]);
  });

  it('E06: con comprobante de billetera en revisión no vence ni se extiende el plazo; el rechazo libera una vez', async () => {
    const api = await buyer();
    const wallet = await placeOrder(api, PaymentMethod.WALLET);
    await submitProof(api, wallet.orderId, 'WALLET', `AIRTM-${key()}`);

    await sweep(wallet.expiresAt + 2 * HOUR);
    const inReview = await order(wallet.orderId);
    assert.equal(inReview.status, 'PENDIENTE');
    assert.equal(inReview.paymentExpiresAt!.getTime(), wallet.expiresAt, 'el comprobante no cambia el plazo guardado');
    assert.equal(await stock(wallet.productId), 4);

    const staffId = await createUser(schema, fx, { permissions: ['VIEW_ORDERS', 'ALL_BRANCHES'] });
    const staff = await apiFor(app, tenant, staffId, ['VIEW_ORDERS', 'ALL_BRANCHES']);
    assert.equal((await staff.call('POST', `/orders/admin/${wallet.orderId}/payment-proof/reject`)).status, 200);
    assert.equal(await stock(wallet.productId), 5);
    await sweep(wallet.expiresAt + 3 * HOUR);
    assert.equal(await stock(wallet.productId), 5);
    assert.equal(await count(schema, 'inventory_movements', `"refId"=$1 AND "stockDelta" > 0`, [wallet.orderId]), 1);
  });

  it('E07: barridos simultáneos (réplicas) cancelan y reponen una sola vez', async () => {
    const api = await buyer();
    const wallet = await placeOrder(api, PaymentMethod.WALLET);
    await Promise.all(Array.from({ length: 4 }, () => sweep(wallet.expiresAt + 1)));
    assert.equal((await order(wallet.orderId)).status, 'CANCELADO');
    assert.equal(await stock(wallet.productId), 5);
    assert.equal(await count(schema, 'inventory_movements', `"refId"=$1 AND reason='ORDER_EXPIRED'`, [wallet.orderId]), 1);
    assert.equal(await count(schema, 'outbox_events', `"dedupeKey"=$1`, [`order-cancelled-push:${wallet.orderId}`]), 1);
  });

  it('E08: TTL personalizado se aplica al crear y al vencer', async () => {
    try {
      process.env.ORDER_TTL_MANUAL_MS = String(2 * HOUR);
      process.env.ORDER_TTL_CARD_MS = String(5 * 60 * 1000);
      const api = await buyer();
      const wallet = await placeOrder(api, PaymentMethod.WALLET);
      const card = await placeOrder(api);
      assertDeadline(wallet, 2 * HOUR);
      assertDeadline(card, 5 * 60 * 1000);

      await sweep(card.expiresAt + 1);
      assert.equal((await order(card.orderId)).status, 'CANCELADO');
      assert.equal((await order(wallet.orderId)).status, 'PENDIENTE');
      await sweep(wallet.expiresAt + 1);
      assert.equal((await order(wallet.orderId)).status, 'CANCELADO');
      assert.equal(await stock(wallet.productId), 5);
    } finally {
      for (const name of TTL_ENV) delete process.env[name];
    }
  });
});
