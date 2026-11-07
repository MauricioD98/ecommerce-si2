import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { TENANT_A, TENANT_B, apiFor, bootApp, createProduct, createUser, key, queryRows, seedTenant, type Api, type Fixture } from './support/world';

// POST /admin/offline-sync: cambios del panel hechos sin conexión. Escritura condicionada a lo que el
// dispositivo leyó, comprobada dentro de la transacción, con recibo por changeId.
const schema = TENANT_A.schemaName;
const tenant = TENANT_A.tenantId;
const MANAGE = ['MANAGE_PRODUCTS', 'ALL_BRANCHES'];

describe('Panel sin conexión: POST /admin/offline-sync', () => {
  let app: INestApplication;
  let fx: Fixture;

  const sync = (api: Api, body: unknown) => api.call('POST', '/admin/offline-sync', { body });
  const product = async (id: string) =>
    (await queryRows(`SELECT name, price::float AS price, "isActive", sku, "updatedAt" FROM "${schema}".products WHERE id=$1`, [id]))[0];
  const receipts = async (changeId: string) =>
    (await queryRows(`SELECT * FROM "${schema}".offline_sync_receipts WHERE "changeId"=$1`, [changeId])).length;
  const admin = async (permissions = MANAGE) => apiFor(app, tenant, await createUser(schema, fx, { permissions }), permissions);

  before(async () => {
    app = await bootApp();
    fx = await seedTenant(schema);
  });
  after(async () => {
    await app?.close();
  });

  it('A01: edita un producto si sigue como lo leyó el dispositivo; el reintento no vuelve a escribir', async () => {
    const api = await admin();
    const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 5 } }, 100);
    const body = { changeId: randomUUID(), entity: 'product', op: 'update', entityId: productId, changes: { price: 120, name: 'Vestido' }, expected: { price: 100, name: 'P' } };
    const res = await sync(api, body);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.alreadyApplied, false);
    const after1 = await product(productId);
    assert.equal(after1.price, 120);
    assert.equal(after1.name, 'Vestido');
    assert.equal(await receipts(body.changeId), 1);

    // Respuesta perdida: el reintento confirma sin escribir, aunque otro dispositivo haya restaurado el precio
    await queryRows(`UPDATE "${schema}".products SET price=100 WHERE id=$1`, [productId]);
    const retry = await sync(api, body);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.alreadyApplied, true);
    assert.equal((await product(productId)).price, 100, 'no se reaplica sobre el cambio posterior');
  });

  it('A02: conflicto si el dato cambió en el servidor: 409 con el valor actual y nada escrito', async () => {
    const api = await admin();
    const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 5 } }, 100);
    await queryRows(`UPDATE "${schema}".products SET price=150 WHERE id=$1`, [productId]);
    const changeId = randomUUID();
    const res = await sync(api, { changeId, entity: 'product', op: 'update', entityId: productId, changes: { price: 120, isActive: false }, expected: { price: 100, isActive: true } });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'OFFLINE_CONFLICT');
    assert.deepEqual(res.body.fields, ['price']);
    assert.equal(res.body.current.price, 150);
    const row = await product(productId);
    assert.equal(row.price, 150);
    assert.equal(row.isActive, true, 'todo o nada');
    assert.equal(await receipts(changeId), 0);

    // Otro campo cambió en el servidor (el nombre): no es conflicto para un cambio de precio
    await queryRows(`UPDATE "${schema}".products SET name='Otro' WHERE id=$1`, [productId]);
    const ok = await sync(api, { changeId: randomUUID(), entity: 'product', op: 'update', entityId: productId, changes: { price: 130 }, expected: { price: 150 } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal((await product(productId)).name, 'Otro');
  });

  it('A03: categorías y colecciones: crear con id del dispositivo es idempotente; editar detecta conflictos', async () => {
    const api = await admin();
    const categoryId = randomUUID();
    const create = { changeId: randomUUID(), entity: 'category', op: 'create', entityId: categoryId, changes: { name: 'Sin Red ' + categoryId.slice(0, 6) } };
    const first = await sync(api, create);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const second = await sync(api, create);
    assert.equal(second.status, 200);
    assert.equal(second.body.alreadyApplied, true);
    assert.equal((await queryRows(`SELECT * FROM "${schema}".categories WHERE id=$1`, [categoryId])).length, 1, 'una sola categoría');

    const collectionId = randomUUID();
    assert.equal((await sync(api, { changeId: randomUUID(), entity: 'collection', op: 'create', entityId: collectionId, changes: { name: 'Col ' + collectionId.slice(0, 6) } })).status, 200);
    await queryRows(`UPDATE "${schema}".collections SET "isActive"=false WHERE id=$1`, [collectionId]);
    const conflict = await sync(api, { changeId: randomUUID(), entity: 'collection', op: 'update', entityId: collectionId, changes: { isActive: true, description: 'x' }, expected: { isActive: true, description: null } });
    assert.equal(conflict.status, 409);
    assert.deepEqual(conflict.body.fields, ['isActive']);
    const edit = await sync(api, { changeId: randomUUID(), entity: 'category', op: 'update', entityId: categoryId, changes: { description: 'Nueva' }, expected: { description: null } });
    assert.equal(edit.status, 200, JSON.stringify(edit.body));
  });

  it('A04: estado de pedido: aplica solo si sigue en el estado leído; cancelar exige conexión', async () => {
    const buyerId = await createUser(schema, fx);
    const buyer = await apiFor(app, tenant, buyerId);
    const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 5 } });
    await buyer.addToCart(productId, 1, 'M', fx.branchA);
    const created = await buyer.createOrder({ key: key(), cartVersion: await buyer.cartVersion(), items: [{ productId, quantity: 1, size: 'M' }], branchId: fx.branchA });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const orderId = created.body.data.id;
    const api = await admin(['VIEW_ORDERS', 'ALL_BRANCHES']);
    const status = async () => (await queryRows(`SELECT status FROM "${schema}".orders WHERE id=$1`, [orderId]))[0].status;

    const cancel = await sync(api, { changeId: randomUUID(), entity: 'order', op: 'update', entityId: orderId, changes: { status: 'CANCELADO' }, expected: { status: 'PENDIENTE' } });
    assert.equal(cancel.status, 400, 'cancelar devuelve stock: no se hace sin conexión');
    assert.equal(await status(), 'PENDIENTE');

    const ok = await sync(api, { changeId: randomUUID(), entity: 'order', op: 'update', entityId: orderId, changes: { status: 'PROCESANDO' }, expected: { status: 'PENDIENTE' } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(await status(), 'PROCESANDO');
    const stale = await sync(api, { changeId: randomUUID(), entity: 'order', op: 'update', entityId: orderId, changes: { status: 'ENVIADO' }, expected: { status: 'PENDIENTE' } });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.current.status, 'PROCESANDO');
    assert.equal(await status(), 'PROCESANDO');
  });

  it('A05: reglas: permisos por entidad, campos no permitidos, sin valor esperado, borrar no existe, mismo DTO', async () => {
    const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 5 } }, 100);
    const ordersOnly = await admin(['VIEW_ORDERS']);
    assert.equal((await sync(ordersOnly, { changeId: randomUUID(), entity: 'product', op: 'update', entityId: productId, changes: { price: 1 }, expected: { price: 100 } })).status, 403);
    const client = await apiFor(app, tenant, await createUser(schema, fx));
    assert.equal((await sync(client, { changeId: randomUUID(), entity: 'product', op: 'update', entityId: productId, changes: { price: 1 }, expected: { price: 100 } })).status, 403);

    const api = await admin();
    assert.equal((await sync(api, { changeId: randomUUID(), entity: 'product', op: 'update', entityId: productId, changes: { price: 1 }, expected: {} })).status, 400, 'sin esperado = ciega');
    assert.equal((await sync(api, { changeId: randomUUID(), entity: 'product', op: 'update', entityId: productId, changes: { stock: 999 }, expected: { stock: 5 } })).status, 400, 'stock no');
    assert.equal((await sync(api, { changeId: randomUUID(), entity: 'product', op: 'create', entityId: randomUUID(), changes: { name: 'x' } })).status, 400, 'crear productos exige conexión');
    assert.equal((await sync(api, { changeId: randomUUID(), entity: 'product', op: 'delete', entityId: productId, changes: {} })).status, 400);
    assert.equal((await sync(api, { changeId: randomUUID(), entity: 'product', op: 'update', entityId: productId, changes: { price: -5 }, expected: { price: 100 } })).status, 400, 'mismas validaciones del DTO');
    assert.equal((await product(productId)).price, 100);
  });

  it('A06: aislamiento: el changeId de otra cuenta no sirve y el token de una tienda no vale en otra', async () => {
    const [a, b] = [await admin(), await admin()];
    const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 5 } }, 100);
    const changeId = randomUUID();
    assert.equal((await sync(a, { changeId, entity: 'product', op: 'update', entityId: productId, changes: { price: 110 }, expected: { price: 100 } })).status, 200);
    const reused = await sync(b, { changeId, entity: 'product', op: 'update', entityId: productId, changes: { price: 90 }, expected: { price: 110 } });
    assert.equal(reused.status, 409);
    assert.equal((await product(productId)).price, 110);

    await seedTenant(TENANT_B.schemaName);
    const crossed = a.as(a.token!, TENANT_B.tenantId);
    assert.equal((await sync(crossed, { changeId: randomUUID(), entity: 'product', op: 'update', entityId: productId, changes: { price: 1 }, expected: { price: 110 } })).status, 401);
  });

  it('A07: el mismo cambio enviado varias veces a la vez se aplica una sola vez', async () => {
    const api = await admin();
    const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 5 } }, 100);
    const body = { changeId: randomUUID(), entity: 'product', op: 'update', entityId: productId, changes: { price: 105 }, expected: { price: 100 } };
    const results = await Promise.all([sync(api, body), sync(api, body), sync(api, body)]);
    assert.deepEqual(results.map((r) => r.status), [200, 200, 200], JSON.stringify(results.map((r) => r.body)));
    assert.equal(results.filter((r) => r.body.alreadyApplied === false).length, 1);
    assert.equal(await receipts(body.changeId), 1);
    assert.equal((await product(productId)).price, 105);
  });
});
