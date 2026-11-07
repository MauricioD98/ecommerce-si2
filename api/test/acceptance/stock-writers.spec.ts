import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { InventoryService } from '../../src/modules/branches/inventory.service';
import { PrismaService } from '../../src/prisma/prisma.service';
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
  spawnReplica,
  stockOf,
  type Fixture,
} from './support/world';

const schema = TENANT_A.schemaName;
const tenant = TENANT_A.tenantId;
const STAFF = ['MANAGE_INVENTORY', 'ALL_BRANCHES', 'USE_POS', 'PROCESS_RETURNS', 'VIEW_ORDERS'];

describe('Todos los escritores de stock', () => {
  let app: INestApplication;
  let fx: Fixture;
  let staff: Api;
  let staffId: string;
  let replica: Awaited<ReturnType<typeof spawnReplica>>;

  const versionOf = async (productId: string, branchId: string, size: string): Promise<number> => {
    const [row] = await queryRows(`SELECT version FROM "${schema}".product_inventories WHERE "productId"=$1 AND "branchId"=$2 AND size=$3`, [productId, branchId, size]);
    return row?.version ?? 0;
  };

  let previousPlan: string;

  before(async () => {
    // POS y devoluciones exigen Growth o superior (@RequirePlanFeature): esta suite los usa, así que su
    // tienda es Growth. Se fija antes de arrancar la app y la réplica, que cachean el plan de la tienda.
    const [row] = await queryRows(`SELECT plan FROM public.tenants WHERE id=$1`, [tenant]);
    previousPlan = row.plan;
    await queryRows(`UPDATE public.tenants SET plan='growth' WHERE id=$1`, [tenant]);
    app = await bootApp();
    fx = await seedTenant(schema);
    staffId = await createUser(schema, fx, { permissions: STAFF });
    staff = await apiFor(app, tenant, staffId, STAFF);
    replica = await spawnReplica(39102);
  });
  after(async () => {
    await replica.stop();
    await app.close();
    await queryRows(`UPDATE public.tenants SET plan=$2 WHERE id=$1`, [tenant, previousPlan]);
  });

  it('I01: un ajuste offline basado en stock viejo recibe conflicto y no resucita unidades vendidas', async () => {
    const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 5 } });
    const readVersion = await versionOf(productId, fx.branchA, 'M');

    // Venta mientras el ajuste espera en la cola offline
    const buyerId = await createUser(schema, fx);
    const buyer = await apiFor(app, tenant, buyerId);
    const sale = await buyer.createOrder({ key: key(), cartVersion: await buyer.cartVersion(), items: [{ productId, quantity: 2, size: 'M' }], branchId: fx.branchA });
    assert.equal(sale.status, 201);

    const operationId = randomUUID();
    const offline = await staff.call('PUT', `/branches/${fx.branchA}/inventory/${productId}`, {
      body: { operationId, sizes: [{ size: 'M', stock: 5, expectedVersion: readVersion }] },
    });
    assert.equal(offline.status, 409);
    assert.equal(offline.body.code, 'INVENTORY_VERSION_CONFLICT');
    assert.deepEqual(offline.body.conflicts[0], { size: 'M', expectedVersion: readVersion, currentVersion: readVersion + 1, currentStock: 3, proposedStock: 5 });
    assert.equal((await stockOf(schema, productId, fx.branchA, 'M'))?.stock, 3);

    // Resolución explícita sobre la versión actual, y reenviar la misma operación no la aplica dos veces
    const resolved = randomUUID();
    const body = { operationId: resolved, sizes: [{ size: 'M', stock: 8, expectedVersion: readVersion + 1 }] };
    const applied = await staff.call('PUT', `/branches/${fx.branchA}/inventory/${productId}`, { body });
    assert.equal(applied.status, 200);
    assert.equal((await stockOf(schema, productId, fx.branchA, 'M'))?.stock, 8);
    assert.equal(applied.body.sizes[0].version, readVersion + 2);
    const retried = await staff.call('PUT', `/branches/${fx.branchA}/inventory/${productId}`, { body });
    assert.equal(retried.status, 200);
    assert.equal((await stockOf(schema, productId, fx.branchA, 'M'))?.stock, 8);
    assert.equal(await versionOf(productId, fx.branchA, 'M'), readVersion + 2);
    assert.equal(await count(schema, 'inventory_movements', `"effectId"=$1`, [`adjust:${resolved}:M`]), 1);

    // Ajuste sin versión o sin operación: el contrato viejo se rechaza
    const legacy = await staff.call('PUT', `/branches/${fx.branchA}/inventory/${productId}`, { body: { sizes: [{ size: 'M', stock: 99 }] } });
    assert.equal(legacy.status, 400);
    assert.equal((await stockOf(schema, productId, fx.branchA, 'M'))?.stock, 8);

    // Un ajuste con dos tallas es todo o nada
    const multi = await createProduct(schema, fx, { [fx.branchA]: { M: 1, L: 1 } });
    const mv = await versionOf(multi, fx.branchA, 'M');
    const partial = await staff.call('PUT', `/branches/${fx.branchA}/inventory/${multi}`, {
      body: { operationId: randomUUID(), sizes: [{ size: 'M', stock: 5, expectedVersion: mv }, { size: 'L', stock: 5, expectedVersion: 999 }] },
    });
    assert.equal(partial.status, 409);
    assert.equal((await stockOf(schema, multi, fx.branchA, 'M'))?.stock, 1);
    // Sin permiso de la sucursal o de inventario no entra
    const plain = await apiFor(app, tenant, buyerId);
    assert.equal((await plain.call('PUT', `/branches/${fx.branchA}/inventory/${productId}`, { body })).status, 403);
  });

  it('I02: POS y web compiten por la última unidad, en dos procesos', async () => {
    for (let round = 0; round < 5; round += 1) {
      const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 1 } });
      const buyerId = await createUser(schema, fx);
      const buyer = await apiFor(app, tenant, buyerId);
      const version = await buyer.cartVersion();
      const remote = new Api(replica.url, tenant, buyer.token);
      const [web, pos] = await Promise.all([
        remote.createOrder({ key: key(), cartVersion: version, items: [{ productId, quantity: 1, size: 'M' }], branchId: fx.branchA }),
        staff.call('POST', '/pos/checkout', {
          body: { customerId: buyerId, branchId: fx.branchA, paymentMethod: 'CASH', amountReceived: 1000, items: [{ productId, quantity: 1, size: 'M' }] },
        }),
      ]);
      // Cada lado gana (201) o pierde por stock (409): un 403 del plan no es una carrera
      assert.ok([201, 409].includes(web.status) && [201, 409].includes(pos.status), `web ${web.status}, pos ${pos.status} ${JSON.stringify(pos.body)}`);
      const wins = [web.status, pos.status].filter((s) => s === 201).length;
      assert.equal(wins, 1, `web ${web.status} ${JSON.stringify(web.body?.code)}, pos ${pos.status} ${JSON.stringify(pos.body)}`);
      assert.equal((await stockOf(schema, productId, fx.branchA, 'M'))?.stock, 0);
      assert.equal(await count(schema, 'order_items', `"productId"=$1`, [productId]), 1);
      const [{ stock }] = await queryRows(`SELECT stock FROM "${schema}".products WHERE id=$1`, [productId]);
      assert.equal(stock, 0);
    }
  });

  it('I03: mermas y devoluciones concurrentes: nunca más de lo vendido y las mermas no se venden', async () => {
    const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 4 } });
    const buyerId = await createUser(schema, fx);
    const sale = await staff.call('POST', '/pos/checkout', {
      body: { customerId: buyerId, branchId: fx.branchA, paymentMethod: 'CASH', amountReceived: 1000, items: [{ productId, quantity: 3, size: 'M' }] },
    });
    assert.equal(sale.status, 201, JSON.stringify(sale.body));
    const orderId = sale.body.data.orderId;
    assert.equal((await stockOf(schema, productId, fx.branchA, 'M'))?.stock, 1);
    const [item] = await queryRows(`SELECT id FROM "${schema}".order_items WHERE "orderId"=$1`, [orderId]);

    const giveBack = (condition: string, quantity: number, target: Api = staff) =>
      target.call('POST', '/returns/process', {
        body: { orderId, branchId: fx.branchA, items: [{ orderItemId: item.id, quantity, reason: 'OTHER', condition }] },
      });
    const remoteStaff = new Api(replica.url, tenant, staff.token);
    const results = await Promise.all([
      giveBack('SELLABLE', 2),
      giveBack('DAMAGED', 2, remoteStaff),
      giveBack('SELLABLE', 2),
      giveBack('DAMAGED', 2, remoteStaff),
      giveBack('SELLABLE', 1),
    ]);
    const ok = results.filter((r) => r.status === 201 || r.status === 200);
    const [{ returned }] = await queryRows(`SELECT COALESCE(SUM(quantity),0)::int returned FROM "${schema}".return_items WHERE "orderItemId"=$1`, [item.id]);
    assert.ok(returned <= 3, `se devolvieron ${returned} de 3`);
    assert.ok(ok.length >= 1);

    const row = await stockOf(schema, productId, fx.branchA, 'M');
    const [{ sellableBack }] = await queryRows(`SELECT COALESCE(SUM(quantity),0)::int "sellableBack" FROM "${schema}".return_items WHERE "orderItemId"=$1 AND condition='SELLABLE'`, [item.id]);
    const [{ damagedBack }] = await queryRows(`SELECT COALESCE(SUM(quantity),0)::int "damagedBack" FROM "${schema}".return_items WHERE "orderItemId"=$1 AND condition='DAMAGED'`, [item.id]);
    assert.equal(row?.stock, 1 + sellableBack);
    assert.equal(row?.damaged, damagedBack);
    assert.equal(await count(schema, 'inventory_movements', `"refType"='RETURN' AND "productId"=$1`, [productId]), ok.length);

    // Las mermas no se venden: agotado lo vendible, comprar falla aunque haya mermas
    const merma = await createProduct(schema, fx, { [fx.branchA]: { M: 0 } });
    await queryRows(`UPDATE "${schema}".product_inventories SET "damagedStock"=9 WHERE "productId"=$1`, [merma]);
    const buyer = await apiFor(app, tenant, buyerId);
    const refused = await buyer.createOrder({ key: key(), cartVersion: await buyer.cartVersion(), items: [{ productId: merma, quantity: 1, size: 'M' }], branchId: fx.branchA });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, 'OUT_OF_STOCK');

    // La base rechaza stock o mermas negativos aunque un bug los intentara
    await assert.rejects(queryRows(`UPDATE "${schema}".product_inventories SET stock=-1 WHERE "productId"=$1`, [merma]));
    await assert.rejects(queryRows(`UPDATE "${schema}".product_inventories SET "damagedStock"=-1 WHERE "productId"=$1`, [merma]));
  });

  it('I04: la regla comercial sigue: una tienda Starter no usa POS ni devoluciones', async () => {
    const [row] = await queryRows(`SELECT plan FROM public.tenants WHERE id=$1`, [TENANT_B.tenantId]);
    assert.ok(['free', 'starter'].includes(row.plan), `la tienda B debería ser Starter, es ${row.plan}`);
    const betaSchema = TENANT_B.schemaName;
    const betaFx = await seedTenant(betaSchema);
    const betaStaffId = await createUser(betaSchema, betaFx, { permissions: STAFF });
    const betaStaff = await apiFor(app, TENANT_B.tenantId, betaStaffId, STAFF);
    const productId = await createProduct(betaSchema, betaFx, { [betaFx.branchA]: { M: 2 } });
    const pos = await betaStaff.call('POST', '/pos/checkout', {
      body: { customerId: betaStaffId, branchId: betaFx.branchA, paymentMethod: 'CASH', amountReceived: 1000, items: [{ productId, quantity: 1, size: 'M' }] },
    });
    assert.equal(pos.status, 403, JSON.stringify(pos.body));
    const returns = await betaStaff.call('POST', '/returns/process', {
      body: { orderId: randomUUID(), branchId: betaFx.branchA, items: [{ orderItemId: randomUUID(), quantity: 1, reason: 'OTHER', condition: 'SELLABLE' }] },
    });
    assert.equal(returns.status, 403, JSON.stringify(returns.body));
    assert.equal((await stockOf(betaSchema, productId, betaFx.branchA, 'M'))?.stock, 2);
  });

  it('M02: variantes distintas actualizan el agregado a la vez sin desfase', async () => {
    const productId = await createProduct(schema, fx, { [fx.branchA]: { S: 40, M: 40, L: 40 }, [fx.branchB]: { S: 40, M: 40, L: 40 } });
    const buyers = await Promise.all(
      Array.from({ length: 36 }, async () => {
        const id = await createUser(schema, fx);
        return apiFor(app, tenant, id);
      }),
    );
    const sizes = ['S', 'M', 'L'];
    const results = await Promise.all(
      buyers.map((api, i) => {
        const target = i % 2 ? api : new Api(replica.url, tenant, api.token);
        return target.addToCart(productId, 1, sizes[i % 3], i % 4 < 2 ? fx.branchA : fx.branchB);
      }),
    );
    assert.ok(results.every((r) => r.status === 201), JSON.stringify(results.map((r) => [r.status, r.body?.code ?? r.body?.message])));
    const [{ stock }] = await queryRows(`SELECT stock FROM "${schema}".products WHERE id=$1`, [productId]);
    const [{ total }] = await queryRows(`SELECT SUM(stock)::int total FROM "${schema}".product_inventories WHERE "productId"=$1`, [productId]);
    assert.equal(total, 240 - 36);
    assert.equal(stock, total);

    // Autoridad falsa: un agregado inflado a mano no autoriza vender una variante agotada
    const fake = await createProduct(schema, fx, { [fx.branchA]: { M: 0 } });
    await queryRows(`UPDATE "${schema}".products SET stock=999 WHERE id=$1`, [fake]);
    const inventory = app.get(InventoryService, { strict: false });
    const prisma = app.get(PrismaService, { strict: false });
    await assert.rejects(inTenantA(() => prisma.$transaction((tx) => inventory.decrement(tx, fake, fx.branchA, 'M', 1))));
    const [{ stock: untouched }] = await queryRows(`SELECT stock FROM "${schema}".products WHERE id=$1`, [fake]);
    assert.equal(untouched, 999);
  });
});
