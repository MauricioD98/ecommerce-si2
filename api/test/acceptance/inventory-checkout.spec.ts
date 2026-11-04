import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { clearFailpoints, setFailpoint } from '../../src/common/checkout/failpoints';
import { CartCleanupService } from '../../src/modules/cart/cart-cleanup.service';
import {
  Api,
  TENANT_A,
  apiFor,
  assertConservation,
  barrier,
  bootApp,
  count,
  createProduct,
  createUser,
  inTenantA,
  key,
  queryRows,
  seedTenant,
  spawnReplica,
  stockOf,
  type Fixture,
} from './support/world';

const schema = TENANT_A.schemaName;
const tenant = TENANT_A.tenantId;

describe('Inventario, reservas y checkout idempotente', () => {
  let app: INestApplication;
  let fx: Fixture;
  let replica: Awaited<ReturnType<typeof spawnReplica>>;
  let base: Api;

  const buyer = async (): Promise<{ id: string; api: Api }> => {
    const id = await createUser(schema, fx);
    return { id, api: await apiFor(app, tenant, id) };
  };

  before(async () => {
    app = await bootApp();
    fx = await seedTenant(schema);
    base = await apiFor(app, tenant);
    replica = await spawnReplica(39101);
  });
  after(async () => {
    await replica.stop();
    await app.close();
  });
  afterEach(() => clearFailpoints());

  it('C01: 100 compradores compiten por una unidad, en dos procesos', async () => {
    const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 1 } });
    const buyers = await Promise.all(Array.from({ length: 100 }, () => buyer()));
    const results = await Promise.all(
      buyers.map(({ api }, i) => {
        const target = i % 2 === 0 ? api : new Api(replica.url, tenant, api.token);
        return target.addToCart(productId, 1, 'M', fx.branchA);
      }),
    );
    const won = results.filter((r) => r.status === 201);
    const lost = results.filter((r) => r.status === 409);
    assert.equal(won.length, 1, `ganadores: ${won.length}; estados ${[...new Set(results.map((r) => r.status))]}`);
    assert.equal(lost.length, 99);
    assert.ok(lost.every((r) => r.body.code === 'OUT_OF_STOCK'));
    assert.equal((await stockOf(schema, productId, fx.branchA, 'M'))?.stock, 0);
    await assertConservation(schema, productId, 1);
    assert.equal(await count(schema, 'inventory_movements', `"productId"=$1 AND "stockDelta"<0`, [productId]), 1);
  });

  it('C01b: 100 compras directas por la última unidad producen una sola orden', async () => {
    const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 1 } });
    const buyers = await Promise.all(Array.from({ length: 100 }, () => buyer()));
    const versions = await Promise.all(buyers.map(({ api }) => api.cartVersion()));
    const results = await Promise.all(
      buyers.map(({ api }, i) => {
        const target = i % 2 === 0 ? api : new Api(replica.url, tenant, api.token);
        return target.createOrder({ key: key(), cartVersion: versions[i], items: [{ productId, quantity: 1, size: 'M' }], branchId: fx.branchA });
      }),
    );
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal(results.filter((r) => r.status === 409 && r.body.code === 'OUT_OF_STOCK').length, 99);
    assert.equal(await count(schema, 'order_items', `"productId"=$1`, [productId]), 1);
    await assertConservation(schema, productId, 1);
  });

  it('C02: la reserva de A no la consume B', async () => {
    const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 1 } });
    const [a, b] = [await buyer(), await buyer()];
    assert.equal((await a.api.addToCart(productId, 1, 'M', fx.branchA)).status, 201);
    const bOrder = await b.api.createOrder({ key: key(), cartVersion: await b.api.cartVersion(), items: [{ productId, quantity: 1, size: 'M' }], branchId: fx.branchA });
    assert.equal(bOrder.status, 409);
    assert.equal(bOrder.body.code, 'OUT_OF_STOCK');
    const aOrder = await a.api.createOrder({ key: key(), cartVersion: await a.api.cartVersion(), items: [{ productId, quantity: 1, size: 'M' }], branchId: fx.branchA });
    assert.equal(aOrder.status, 201);
    await assertConservation(schema, productId, 1);
  });

  it('C03: talla agotada falla aunque otras tallas y sucursales tengan stock', async () => {
    const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 0, L: 9 }, [fx.branchB]: { M: 9 } });
    const { api } = await buyer();
    const res = await api.createOrder({ key: key(), cartVersion: await api.cartVersion(), items: [{ productId, quantity: 1, size: 'M' }], branchId: fx.branchA });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'OUT_OF_STOCK');
    assert.equal((await stockOf(schema, productId, fx.branchA, 'L'))?.stock, 9);
    assert.equal((await stockOf(schema, productId, fx.branchB, 'M'))?.stock, 9);
    // Un agregado global grande tampoco autoriza: la variante inexistente falla igual
    const missing = await api.createOrder({ key: key(), cartVersion: await api.cartVersion(), items: [{ productId, quantity: 1, size: 'L' }], branchId: fx.branchB });
    assert.equal(missing.status, 409);
    assert.equal(await count(schema, 'product_inventories', `"productId"=$1 AND "branchId"=$2 AND size='L'`, [productId, fx.branchB]), 0);
  });

  it('C04: doble clic y dos pestañas con la misma clave, en dos procesos', async () => {
    const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 5 } });
    const { id, api } = await buyer();
    await api.addToCart(productId, 1, 'M', fx.branchA);
    const cartVersion = await api.cartVersion();
    const k = key();
    const send = (target: Api) => target.createOrder({ key: k, cartVersion, items: [{ productId, quantity: 1, size: 'M' }], branchId: fx.branchA });
    const remote = new Api(replica.url, tenant, api.token);
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => send(i % 2 ? api : remote)));
    assert.ok(results.every((r) => r.status === 201), JSON.stringify(results.map((r) => [r.status, r.body?.code])));
    assert.equal(new Set(results.map((r) => r.body.data.id)).size, 1);
    assert.equal(await count(schema, 'orders', `"userId"=$1`, [id]), 1);
    assert.equal(await count(schema, 'checkout_attempts', `"userId"=$1`, [id]), 1);
    assert.equal((await stockOf(schema, productId, fx.branchA, 'M'))?.stock, 4);
    const attempt = await api.call('GET', `/orders/attempts/${k}`);
    assert.equal(attempt.body.data.status, 'SUCCEEDED');
    assert.equal(attempt.body.data.orderId, results[0].body.data.id);
  });

  it('C05: claves distintas no consumen dos veces la misma revisión', async () => {
    const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 5 } });
    const { id, api } = await buyer();
    await api.addToCart(productId, 2, 'M', fx.branchA);
    const cartVersion = await api.cartVersion();
    const send = () => api.createOrder({ key: key(), cartVersion, items: [{ productId, quantity: 2, size: 'M' }], branchId: fx.branchA });
    const results = await Promise.all([send(), send(), send()]);
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal(results.filter((r) => r.status === 409 && r.body.code === 'CART_VERSION_CONFLICT').length, 2);
    assert.equal(await count(schema, 'orders', `"userId"=$1`, [id]), 1);
    assert.equal((await stockOf(schema, productId, fx.branchA, 'M'))?.stock, 3);
    await assertConservation(schema, productId, 5);
    // Dos compras deliberadamente distintas sí pueden existir si hay stock
    const second = await api.createOrder({ key: key(), cartVersion: await api.cartVersion(), items: [{ productId, quantity: 1, size: 'M' }], branchId: fx.branchA });
    assert.equal(second.status, 201);
    assert.equal(await count(schema, 'orders', `"userId"=$1`, [id]), 2);
  });

  it('C06: misma clave con payload distinto responde 409 y no muta nada', async () => {
    const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 5 } });
    const { id, api } = await buyer();
    const cartVersion = await api.cartVersion();
    const k = key();
    const first = await api.createOrder({ key: k, cartVersion, items: [{ productId, quantity: 1, size: 'M' }], branchId: fx.branchA });
    assert.equal(first.status, 201);
    const before = await stockOf(schema, productId, fx.branchA, 'M');
    const second = await api.createOrder({ key: k, cartVersion, items: [{ productId, quantity: 2, size: 'M' }], branchId: fx.branchA });
    assert.equal(second.status, 409);
    assert.equal(second.body.code, 'IDEMPOTENCY_KEY_REUSED');
    assert.deepEqual(await stockOf(schema, productId, fx.branchA, 'M'), before);
    assert.equal(await count(schema, 'orders', `"userId"=$1`, [id]), 1);
  });

  it('C06b: un cliente viejo sin clave o sin revisión no entra por un camino inseguro', async () => {
    const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 5 } });
    const { id, api } = await buyer();
    const withoutKey = await api.call('POST', '/orders', { body: { cartVersion: 1, fulfillmentType: 'PICKUP', branchId: fx.branchA, items: [{ productId, quantity: 1, size: 'M' }] } });
    assert.equal(withoutKey.status, 400);
    assert.equal(withoutKey.body.code, 'IDEMPOTENCY_KEY_REQUIRED');
    const withoutVersion = await api.call('POST', '/orders', { key: key(), body: { fulfillmentType: 'PICKUP', branchId: fx.branchA, items: [{ productId, quantity: 1, size: 'M' }] } });
    assert.equal(withoutVersion.status, 400);
    assert.equal(await count(schema, 'orders', `"userId"=$1`, [id]), 0);
    assert.equal((await stockOf(schema, productId, fx.branchA, 'M'))?.stock, 5);
  });

  it('C07: corte antes de llegar, tras el commit y durante la respuesta: se recupera con la misma clave', async () => {
    const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 9 } });
    const { id, api } = await buyer();

    // Antes de llegar: el primer envío nunca toca la API
    let cartVersion = await api.cartVersion();
    const k1 = key();
    const dead = new Api('http://127.0.0.1:1', tenant, api.token);
    await assert.rejects(dead.createOrder({ key: k1, cartVersion, items: [{ productId, quantity: 1, size: 'M' }], branchId: fx.branchA }));
    assert.equal(await count(schema, 'orders', `"userId"=$1`, [id]), 0);
    const r1 = await api.createOrder({ key: k1, cartVersion, items: [{ productId, quantity: 1, size: 'M' }], branchId: fx.branchA });
    assert.equal(r1.status, 201);

    // Tras el commit: la API responde 500, pero la orden existe
    setFailpoint('orders.afterCommit', () => {
      clearFailpoints();
      throw new Error('crash simulado tras el commit');
    });
    cartVersion = await api.cartVersion();
    const k2 = key();
    const lost = await api.createOrder({ key: k2, cartVersion, items: [{ productId, quantity: 1, size: 'M' }], branchId: fx.branchA });
    assert.equal(lost.status, 500);
    assert.equal(await count(schema, 'orders', `"userId"=$1`, [id]), 2);
    const recovered = await api.createOrder({ key: k2, cartVersion, items: [{ productId, quantity: 1, size: 'M' }], branchId: fx.branchA });
    assert.equal(recovered.status, 201);
    assert.equal(recovered.body.replayed, true);
    assert.equal(await count(schema, 'orders', `"userId"=$1`, [id]), 2);

    // Durante la respuesta: el cliente aborta después del commit y no llega a leerla
    const committed = barrier();
    const hold = barrier();
    setFailpoint('orders.afterCommit', async () => {
      committed.open();
      await hold.opened;
    });
    cartVersion = await api.cartVersion();
    const k3 = key();
    const abort = new AbortController();
    const inFlight = api.createOrder({ key: k3, cartVersion, items: [{ productId, quantity: 1, size: 'M' }], branchId: fx.branchA, signal: abort.signal } as never);
    const aborted = api.call('POST', '/orders', { key: k3, signal: abort.signal, body: { fulfillmentType: 'PICKUP', cartVersion, branchId: fx.branchA, items: [{ productId, quantity: 1, size: 'M' }] } });
    await committed.opened;
    abort.abort();
    await assert.rejects(aborted);
    hold.open();
    await inFlight.catch(() => undefined);
    clearFailpoints();
    const state = await api.call('GET', `/orders/attempts/${k3}`);
    assert.equal(state.body.data.status, 'SUCCEEDED');
    const again = await api.createOrder({ key: k3, cartVersion, items: [{ productId, quantity: 1, size: 'M' }], branchId: fx.branchA });
    assert.equal(again.status, 201);
    assert.equal(await count(schema, 'orders', `"userId"=$1`, [id]), 3);
    assert.equal((await stockOf(schema, productId, fx.branchA, 'M'))?.stock, 6);
  });

  it('C08: consulta sin resultado mientras el POST sigue en vuelo no genera otra compra', async () => {
    const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 9 } });
    const { id, api } = await buyer();
    const cartVersion = await api.cartVersion();
    const k = key();
    const claimed = barrier();
    const release = barrier();
    setFailpoint('orders.beforeCommit', async () => {
      clearFailpoints();
      claimed.open();
      await release.opened;
    });
    const body = { key: k, cartVersion, items: [{ productId, quantity: 1, size: 'M' }], branchId: fx.branchA };
    const first = api.createOrder(body);
    await claimed.opened;

    const probe = await api.call('GET', `/orders/attempts/${k}`);
    assert.equal(probe.status, 404);
    assert.equal(probe.body.code, 'ATTEMPT_NOT_FOUND');

    // El cliente reintenta con la misma clave: ese envío espera al primero, no compra otra vez
    const retry = api.createOrder(body);
    await new Promise((resolve) => setTimeout(resolve, 200));
    release.open();
    const [a, b] = await Promise.all([first, retry]);
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.equal(a.body.data.id, b.body.data.id);
    assert.equal(await count(schema, 'orders', `"userId"=$1`, [id]), 1);
    assert.equal((await stockOf(schema, productId, fx.branchA, 'M'))?.stock, 8);
  });

  it('C09: una línea agotada revierte todo y las líneas repetidas no se cuentan dos veces', async () => {
    const ok = await createProduct(schema, fx, { [fx.branchA]: { M: 5 } });
    const scarce = await createProduct(schema, fx, { [fx.branchA]: { M: 1 } });
    const { id, api } = await buyer();
    await api.addToCart(ok, 2, 'M', fx.branchA);
    const k = key();
    const cartVersion = await api.cartVersion();
    const failed = await api.createOrder({
      key: k,
      cartVersion,
      branchId: fx.branchA,
      items: [
        { productId: ok, quantity: 1, size: 'M' },
        { productId: ok, quantity: 1, size: 'M' },
        { productId: scarce, quantity: 2, size: 'M' },
      ],
    });
    assert.equal(failed.status, 409);
    assert.equal(failed.body.code, 'OUT_OF_STOCK');
    assert.equal(await count(schema, 'orders', `"userId"=$1`, [id]), 0);
    assert.equal((await stockOf(schema, ok, fx.branchA, 'M'))?.stock, 3);
    assert.equal((await stockOf(schema, scarce, fx.branchA, 'M'))?.stock, 1);
    assert.equal(await count(schema, 'stock_reservations', `"productId"=$1 AND status='ACTIVE'`, [ok]), 1);
    // La misma clave conserva su rechazo: volver a comprar exige revisión y una clave nueva
    const repeat = await api.createOrder({ key: k, cartVersion, branchId: fx.branchA, items: [{ productId: ok, quantity: 2, size: 'M' }, { productId: scarce, quantity: 2, size: 'M' }] });
    assert.equal(repeat.status, 409);

    // Las dos líneas repetidas se normalizan: consumen la reserva de 2, sin descontar más
    const merged = await api.createOrder({
      key: key(),
      cartVersion,
      branchId: fx.branchA,
      items: [
        { productId: ok, quantity: 1, size: 'M' },
        { productId: ok, quantity: 1, size: 'M' },
      ],
    });
    assert.equal(merged.status, 201);
    assert.equal(merged.body.data.items.length, 1);
    assert.equal(merged.body.data.items[0].quantity, 2);
    assert.equal((await stockOf(schema, ok, fx.branchA, 'M'))?.stock, 3);
    await assertConservation(schema, ok, 5);
  });

  it('C10: aumentar, reducir, eliminar y cambiar de sucursal a la vez conserva las unidades', async () => {
    const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 30 }, [fx.branchB]: { M: 30 } });
    const { api } = await buyer();
    const added = await api.addToCart(productId, 5, 'M', fx.branchA);
    const itemId = added.body.cartItems[0].id;
    const ops = [
      () => api.call('PATCH', `/cart/items/${itemId}`, { body: { quantity: 7 } }),
      () => api.call('PATCH', `/cart/items/${itemId}`, { body: { quantity: 2 } }),
      () => api.call('PATCH', `/cart/items/${itemId}`, { body: { quantity: 3, branchId: fx.branchB } }),
      () => api.addToCart(productId, 1, 'M', fx.branchA),
      () => api.addToCart(productId, 2, 'M', fx.branchB),
      () => api.call('DELETE', `/cart/items/${itemId}`),
    ];
    for (let round = 0; round < 3; round += 1) {
      const results = await Promise.all(ops.map((op) => op()));
      assert.ok(results.every((r) => [200, 201, 404, 409].includes(r.status)), JSON.stringify(results.map((r) => r.status)));
      await assertConservation(schema, productId, 60);
    }
    const [{ held }] = await queryRows(`SELECT COALESCE(SUM(quantity),0)::int held FROM "${schema}".stock_reservations WHERE "productId"=$1 AND status='ACTIVE'`, [productId]);
    const cart = await api.call('GET', '/cart');
    const inCart = cart.body.cartItems.reduce((sum: number, item: { quantity: number }) => sum + item.quantity, 0);
    assert.equal(held, inCart);

    // Cambio de sucursal sin stock en destino: falla entero y la reserva sigue donde estaba
    const scarce = await createProduct(schema, fx, { [fx.branchA]: { M: 5 }, [fx.branchB]: { M: 1 } });
    const moved = await api.addToCart(scarce, 3, 'M', fx.branchA);
    const scarceItem = moved.body.cartItems.find((item: { productId: string }) => item.productId === scarce);
    const refused = await api.call('PATCH', `/cart/items/${scarceItem.id}`, { body: { quantity: 3, branchId: fx.branchB } });
    assert.equal(refused.status, 409);
    assert.equal((await stockOf(schema, scarce, fx.branchA, 'M'))?.stock, 2);
    assert.equal((await stockOf(schema, scarce, fx.branchB, 'M'))?.stock, 1);
    await assertConservation(schema, scarce, 6);

    // Versión de carrito obsoleta
    const stale = await api.call('POST', '/cart/items', { body: { productId: scarce, quantity: 1, size: 'M', branchId: fx.branchA, expectedVersion: 1 } });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'CART_VERSION_CONFLICT');
  });

  it('C11: cron doble, cron contra checkout y limpieza contra actualización', async () => {
    const cleanup = app.get(CartCleanupService, { strict: false });
    const expire = (productId: string) =>
      queryRows(`UPDATE "${schema}".stock_reservations SET "expiresAt" = now() - interval '1 minute' WHERE "productId"=$1 AND status='ACTIVE'`, [productId]);

    // Cron doble (dos réplicas leyendo la misma lista)
    const p1 = await createProduct(schema, fx, { [fx.branchA]: { M: 5 } });
    const u1 = await buyer();
    await u1.api.addToCart(p1, 3, 'M', fx.branchA);
    await expire(p1);
    await Promise.all([inTenantA(() => cleanup.releaseForCurrentTenant()), inTenantA(() => cleanup.releaseForCurrentTenant())]);
    assert.equal((await stockOf(schema, p1, fx.branchA, 'M'))?.stock, 5);
    assert.equal(await count(schema, 'inventory_movements', `"productId"=$1 AND reason='RESERVATION_EXPIRED'`, [p1]), 1);

    // Cron contra checkout: quien llega primero decide; nunca ambos
    const p2 = await createProduct(schema, fx, { [fx.branchA]: { M: 5 } });
    const u2 = await buyer();
    await u2.api.addToCart(p2, 2, 'M', fx.branchA);
    const cartVersion = await u2.api.cartVersion();
    const hold = barrier();
    const inside = barrier();
    setFailpoint('orders.beforeCommit', async () => {
      clearFailpoints();
      inside.open();
      await hold.opened;
    });
    const checkout = u2.api.createOrder({ key: key(), cartVersion, items: [{ productId: p2, quantity: 2, size: 'M' }], branchId: fx.branchA });
    await inside.opened;
    // El barrido cree que ya venció (su reloj va 2 h adelante) y debe esperar al checkout con el carrito bloqueado
    const sweep = inTenantA(() => cleanup.releaseForCurrentTenant(new Date(Date.now() + 2 * 3600 * 1000)));
    await new Promise((resolve) => setTimeout(resolve, 200));
    hold.open();
    const [order] = await Promise.all([checkout, sweep]);
    assert.equal(order.status, 201);
    assert.equal(await count(schema, 'inventory_movements', `"productId"=$1 AND reason='RESERVATION_EXPIRED'`, [p2]), 0);
    assert.equal((await stockOf(schema, p2, fx.branchA, 'M'))?.stock, 3);
    await assertConservation(schema, p2, 5);

    // Limpieza contra actualización del usuario
    const p3 = await createProduct(schema, fx, { [fx.branchA]: { M: 5 } });
    const u3 = await buyer();
    const added = await u3.api.addToCart(p3, 2, 'M', fx.branchA);
    await expire(p3);
    const [patched] = await Promise.all([
      u3.api.call('PATCH', `/cart/items/${added.body.cartItems[0].id}`, { body: { quantity: 4 } }),
      inTenantA(() => cleanup.releaseForCurrentTenant()),
    ]);
    assert.ok([200, 404].includes(patched.status), String(patched.status));
    await assertConservation(schema, p3, 5);
  });

  it('C12: tras un reinicio prolongado el barrido recupera, y el TTL se valida en cada acceso crítico', async () => {
    const cleanup = app.get(CartCleanupService, { strict: false });
    const products = await Promise.all([1, 2, 3].map(() => createProduct(schema, fx, { [fx.branchA]: { M: 4 } })));
    const users = await Promise.all(products.map(() => buyer()));
    await Promise.all(users.map(({ api }, i) => api.addToCart(products[i], 2, 'M', fx.branchA)));
    await queryRows(`UPDATE "${schema}".stock_reservations SET "expiresAt" = now() - interval '3 days' WHERE "productId" = ANY($1) AND status='ACTIVE'`, [products]);

    // Acceso crítico antes del barrido: checkout no acepta una reserva vencida
    const late = await users[0].api.createOrder({ key: key(), cartVersion: await currentVersion(users[0].id), items: [{ productId: products[0], quantity: 2, size: 'M' }], branchId: fx.branchA });
    assert.equal(late.status, 409);
    assert.equal(late.body.code, 'RESERVATION_EXPIRED');
    // Leer el carrito ya no la muestra como vigente
    const cart = await users[1].api.call('GET', '/cart');
    assert.equal(cart.body.cartItems.length, 0);
    assert.equal((await stockOf(schema, products[1], fx.branchA, 'M'))?.stock, 4);

    await inTenantA(() => cleanup.releaseForCurrentTenant());
    for (const productId of products) {
      assert.equal((await stockOf(schema, productId, fx.branchA, 'M'))?.stock, 4);
      await assertConservation(schema, productId, 4);
    }
  });

  async function currentVersion(userId: string): Promise<number> {
    const [{ version }] = await queryRows(`SELECT version FROM "${schema}".carts WHERE "activeUserId"=$1`, [userId]);
    return version;
  }

  it('PRICE_CHANGED: el total aceptado por el cliente se valida en servidor, sin efectos', async () => {
    const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 5 } }, 100);
    const { id, api } = await buyer();
    const res = await api.createOrder({ key: key(), cartVersion: await api.cartVersion(), expectedTotal: 90, items: [{ productId, quantity: 1, size: 'M' }], branchId: fx.branchA });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'PRICE_CHANGED');
    assert.equal(res.body.currentTotal, 100);
    assert.equal(await count(schema, 'orders', `"userId"=$1`, [id]), 0);
    assert.equal((await stockOf(schema, productId, fx.branchA, 'M'))?.stock, 5);
  });

  it('carrito activo único: lecturas concurrentes no crean duplicados', async () => {
    const { id, api } = await buyer();
    const remote = new Api(replica.url, tenant, api.token);
    await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? api : remote).call('GET', '/cart')));
    assert.equal(await count(schema, 'carts', `"userId"=$1 AND checkout=false`, [id]), 1);
    assert.ok(base);
  });
});
