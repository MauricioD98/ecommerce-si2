import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { FakeStripe } from './support/fake-stripe';
import { CheckoutMaintenanceService } from '../../src/modules/payments/checkout-maintenance.service';
import {
  Api,
  TENANT_A,
  TENANT_B,
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

// "Ya realicé la transferencia" (QR bancario): la captura y la referencia son opcionales. El aviso deja el
// pago PENDIENTE hasta que la tienda lo aprueba o rechaza en Pedidos; nunca lo marca pagado ni emite factura.
// Datos de demostración en la base de aceptación; Stripe es el falso local y SMTP está vacío (sin correos).
const schema = TENANT_A.schemaName;
const tenant = TENANT_A.tenantId;
const REVIEW_PERMISSIONS = ['VIEW_ORDERS', 'ALL_BRANCHES'];
const DAY = 24 * 60 * 60 * 1000;
// PNG mínimo: el servidor solo mira la firma
let ip = 0;
// Cada aviso desde otra IP: el endpoint limita 10 por minuto por IP (ThrottlerGuard) y aquí no se prueba eso
const proofHeaders = (api: Api, tenantId = tenant) => {
  ip += 1;
  return { authorization: `Bearer ${api.token}`, 'x-tenant-id': tenantId, 'x-forwarded-for': `10.250.${(ip >> 8) & 255}.${ip & 255}` };
};
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);

describe('Aviso de transferencia por QR bancario (comprobante opcional)', () => {
  let app: INestApplication;
  let fx: Fixture;
  let stripe: FakeStripe;
  let staff: Api;
  let previousPlan: string;

  const buyer = async () => apiFor(app, tenant, await createUser(schema, fx));

  // Pedido PICKUP en sucursal A con dos tallas del mismo producto (M x2, L x1, Bs 100 c/u)
  const placeOrder = async (api: Api) => {
    const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 5, L: 5 } });
    await api.addToCart(productId, 2, 'M', fx.branchA);
    await api.addToCart(productId, 1, 'L', fx.branchA);
    const res = await api.createOrder({
      key: key(),
      cartVersion: await api.cartVersion(),
      paymentMethod: 'BANK_QR',
      items: [
        { productId, quantity: 2, size: 'M' },
        { productId, quantity: 1, size: 'L' },
      ],
      branchId: fx.branchA,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return { orderId: res.body.data.id as string, productId };
  };

  const notify = (api: Api, orderId: string, input: { txId?: string; file?: Buffer; tenantId?: string } = {}) => {
    const form = new FormData();
    form.set('method', 'BANK_QR');
    if (input.txId !== undefined) form.set('txId', input.txId);
    if (input.file) form.set('file', new Blob([new Uint8Array(input.file)], { type: 'image/png' }), 'comprobante.png');
    return fetch(`${api.baseUrl}/api/v1/orders/${orderId}/payment-proof`, {
      method: 'POST',
      headers: proofHeaders(api, input.tenantId ?? tenant),
      body: form,
    });
  };

  const orderRow = async (orderId: string) =>
    (await queryRows(`SELECT status,"paymentStatus","paymentMethod" FROM "${schema}".orders WHERE id=$1`, [orderId]))[0];
  const proofRows = (orderId: string) =>
    queryRows(`SELECT status,"txId","imageType" FROM "${schema}".payment_proofs WHERE "orderId"=$1`, [orderId]);
  const stock = async (productId: string, size: string) => (await stockOf(schema, productId, fx.branchA, size))?.stock;
  const invoiceEvents = (orderId: string) => count(schema, 'outbox_events', `"dedupeKey"=$1`, [`order-paid-invoice:${orderId}`]);

  before(async () => {
    const [row] = await queryRows(`SELECT plan FROM public.tenants WHERE id=$1`, [tenant]);
    previousPlan = row.plan;
    await queryRows(`UPDATE public.tenants SET plan='pro' WHERE id=$1`, [tenant]);
    stripe = new FakeStripe();
    process.env.STRIPE_API_BASE = await stripe.start();
    app = await bootApp();
    fx = await seedTenant(schema);
    await withSql((c) =>
      c.query(
        `INSERT INTO "${schema}".payment_settings (id,"qrEnabled","qrImageType","updatedAt") VALUES ('default',true,'image/png',now())
         ON CONFLICT (id) DO UPDATE SET "qrEnabled"=true,"qrImageType"='image/png'`,
      ),
    );
    const staffId = await createUser(schema, fx, { permissions: REVIEW_PERMISSIONS });
    staff = await apiFor(app, tenant, staffId, REVIEW_PERMISSIONS);
  });
  after(async () => {
    await app.close();
    await stripe.stop();
    await queryRows(`UPDATE public.tenants SET plan=$2 WHERE id=$1`, [tenant, previousPlan]);
  });

  it('T01: sin imagen ni referencia se registra el aviso; el pago queda pendiente y sin factura', async () => {
    const api = await buyer();
    const { orderId, productId } = await placeOrder(api);
    const res = await notify(api, orderId);
    assert.equal(res.status, 201, await res.text());

    assert.deepEqual(await orderRow(orderId), { status: 'PENDIENTE', paymentStatus: 'PENDIENTE', paymentMethod: 'BANK_QR' });
    assert.deepEqual(await proofRows(orderId), [{ status: 'PENDIENTE', txId: null, imageType: null }]);
    assert.equal(await invoiceEvents(orderId), 0);
    assert.equal(await count(schema, 'payments', `"orderId"=$1 AND status='COMPLETADO'`, [orderId]), 0);
    // El stock sigue reservado (no se liberó ni se descontó dos veces)
    assert.equal(await stock(productId, 'M'), 3);
    assert.equal(await stock(productId, 'L'), 4);

    // Lo que usa la pantalla final: datos del pedido en el servidor, no del carrito
    const detail = await api.call('GET', `/orders/${orderId}`);
    assert.equal(detail.status, 200);
    const data = detail.body.data;
    assert.equal(typeof data.orderNumber, 'string');
    assert.ok(data.orderNumber.length > 0);
    assert.equal(data.total, 300);
    assert.equal(data.paymentStatus, 'PENDIENTE');
    assert.deepEqual(data.paymentProof && { status: data.paymentProof.status, hasImage: data.paymentProof.hasImage, txId: data.paymentProof.txId }, { status: 'PENDIENTE', hasImage: false, txId: null });
    assert.deepEqual(
      data.items.map((i: any) => [i.size, i.quantity, i.subtotal]).sort(),
      [['L', 1, 100], ['M', 2, 200]],
    );
  });

  it('T02: con referencia e imagen se guardan ambas; referencia repetida o demasiado corta se rechaza', async () => {
    const api = await buyer();
    const { orderId } = await placeOrder(api);
    const reference = `BNB-${key().slice(0, 8)}`;
    const res = await notify(api, orderId, { txId: reference, file: PNG });
    assert.equal(res.status, 201, await res.text());
    assert.deepEqual(await proofRows(orderId), [{ status: 'PENDIENTE', txId: reference, imageType: 'image/png' }]);

    const other = await buyer();
    const second = await placeOrder(other);
    const reused = await notify(other, second.orderId, { txId: reference.toLowerCase() });
    assert.equal(reused.status, 400);
    const short = await notify(other, second.orderId, { txId: 'ab' });
    assert.equal(short.status, 400);
    assert.equal((await proofRows(second.orderId)).length, 0);
  });

  it('T03: una subida que falla (archivo que no es imagen) no registra nada', async () => {
    const api = await buyer();
    const { orderId } = await placeOrder(api);
    const form = new FormData();
    form.set('method', 'BANK_QR');
    form.set('file', new Blob([new TextEncoder().encode('no soy una imagen')], { type: 'image/png' }), 'x.png');
    const res = await fetch(`${api.baseUrl}/api/v1/orders/${orderId}/payment-proof`, {
      method: 'POST',
      headers: proofHeaders(api),
      body: form,
    });
    assert.equal(res.status, 400);
    assert.equal((await proofRows(orderId)).length, 0);
    assert.deepEqual(await orderRow(orderId), { status: 'PENDIENTE', paymentStatus: 'PENDIENTE', paymentMethod: 'BANK_QR' });
  });

  it('T04: reenviar el aviso (respuesta perdida, doble clic) no duplica pedido ni comprobante', async () => {
    const api = await buyer();
    const { orderId } = await placeOrder(api);
    const results = await Promise.all([notify(api, orderId), notify(api, orderId), notify(api, orderId)]);
    assert.deepEqual(results.map((r) => r.status), [201, 201, 201]);
    assert.equal((await proofRows(orderId)).length, 1);
    const [{ n }] = await queryRows(
      `SELECT COUNT(*)::int AS n FROM "${schema}".orders WHERE "userId"=(SELECT "userId" FROM "${schema}".orders WHERE id=$1)`,
      [orderId],
    );
    assert.equal(n, 1);
  });

  it('T05: el aviso pendiente no vence solo; la tienda lo aprueba y recién ahí queda pagado', async () => {
    const api = await buyer();
    const { orderId, productId } = await placeOrder(api);
    assert.equal((await notify(api, orderId)).status, 201);

    const maintenance = app.get(CheckoutMaintenanceService, { strict: false });
    await inTenantA(() => maintenance.resolveExpiredOrders(new Date(Date.now() + 3 * DAY)));
    assert.deepEqual(await orderRow(orderId), { status: 'PENDIENTE', paymentStatus: 'PENDIENTE', paymentMethod: 'BANK_QR' });

    const approved = await staff.call('POST', `/orders/admin/${orderId}/payment-proof/approve`);
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.deepEqual(await orderRow(orderId), { status: 'PROCESANDO', paymentStatus: 'COMPLETADO', paymentMethod: 'BANK_QR' });
    assert.equal(await invoiceEvents(orderId), 1);
    assert.equal(await stock(productId, 'M'), 3);

    const seen = await api.call('GET', `/orders/${orderId}`);
    assert.equal(seen.body.data.paymentProof.status, 'APROBADO');
    assert.equal(seen.body.data.paymentStatus, 'COMPLETADO');
    // Ya revisado: no se puede volver a avisar
    assert.equal((await notify(api, orderId)).status, 400);
  });

  it('T06: rechazo manual cancela el pedido y repone el stock', async () => {
    const api = await buyer();
    const { orderId, productId } = await placeOrder(api);
    assert.equal((await notify(api, orderId, { txId: `REF-${key().slice(0, 6)}` })).status, 201);
    const rejected = await staff.call('POST', `/orders/admin/${orderId}/payment-proof/reject`);
    assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
    assert.deepEqual(await orderRow(orderId), { status: 'CANCELADO', paymentStatus: 'FALLIDO', paymentMethod: 'BANK_QR' });
    assert.equal(await invoiceEvents(orderId), 0);
    assert.equal(await stock(productId, 'M'), 5);
    assert.equal(await stock(productId, 'L'), 5);
  });

  it('T07: aislamiento: otro cliente o el personal de otra tienda no tocan el pedido', async () => {
    const owner = await buyer();
    const { orderId } = await placeOrder(owner);

    const stranger = await buyer();
    assert.equal((await notify(stranger, orderId)).status, 404);
    assert.equal((await stranger.call('GET', `/orders/${orderId}`)).status, 404);

    // El token de la tienda A presentado en la tienda B no vale
    const crossTenant = await notify(owner, orderId, { tenantId: TENANT_B.tenantId });
    assert.ok([401, 403, 404].includes(crossTenant.status), String(crossTenant.status));

    const fxB = await seedTenant(TENANT_B.schemaName);
    const staffB = await apiFor(app, TENANT_B.tenantId, await createUser(TENANT_B.schemaName, fxB, { permissions: REVIEW_PERMISSIONS }), REVIEW_PERMISSIONS);
    assert.equal((await notify(owner, orderId)).status, 201);
    const foreign = await staffB.call('POST', `/orders/admin/${orderId}/payment-proof/approve`);
    assert.notEqual(foreign.status, 200);
    assert.deepEqual(await orderRow(orderId), { status: 'PENDIENTE', paymentStatus: 'PENDIENTE', paymentMethod: 'BANK_QR' });
  });
});
