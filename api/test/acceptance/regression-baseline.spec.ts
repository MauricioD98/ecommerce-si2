import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { InventoryService } from '../../src/modules/branches/inventory.service';
import { CartService } from '../../src/modules/cart/cart.service';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TENANT_A, bootApp, createProduct, createUser, inTenantA, seedTenant, stockOf, withSql, type Fixture } from './support/world';

// Reproduce sobre el código los hallazgos estáticos de la especificación (§3)
describe('Regresión: fallback de stock, idempotencia y reservas', () => {
  let app: INestApplication;
  let fx: Fixture;
  const schema = TENANT_A.schemaName;

  before(async () => {
    app = await bootApp();
    fx = await seedTenant(schema);
  });
  after(() => app.close());

  it('R1: sin stock en la talla/sucursal pedida, decrement debe fallar y no tocar otra sucursal', async () => {
    const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 0 }, [fx.branchB]: { M: 5 } });
    const inventory = app.get(InventoryService, { strict: false });
    const prisma = app.get(PrismaService, { strict: false });
    await assert.rejects(inTenantA(() => prisma.$transaction((tx) => inventory.decrement(tx, productId, fx.branchA, 'M', 1))));
    assert.equal((await stockOf(schema, productId, fx.branchB, 'M'))?.stock, 5);
  });

  it('R2: dos envíos del mismo intento producen una sola orden', async () => {
    const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 5 } });
    const userId = await createUser(schema, fx);
    const orders = app.get(OrdersService, { strict: false }) as any;
    const key = randomUUID();
    const cartVersion = await inTenantA(async () => (await app.get(CartService, { strict: false }).getOrCreateCart(userId)).version);
    const dto = { items: [{ productId, quantity: 1, size: 'M' }], branchId: fx.branchA, fulfillmentType: 'PICKUP', cartVersion };
    const user = { id: userId, email: 'x', role: 'CLIENTE', permissions: [] };
    await inTenantA(() => orders.create(user, dto, key));
    await inTenantA(() => orders.create(user, dto, key));
    const { rows } = await withSql<any>((c) => c.query(`SELECT count(*)::int n FROM "${schema}".orders WHERE "userId"=$1`, [userId]));
    assert.equal(rows[0].n, 1);
    assert.equal((await stockOf(schema, productId, fx.branchA, 'M'))?.stock, 4);
  });

  it('R3: cambiar de sucursal un ítem del carrito transfiere la reserva sin perder unidades', async () => {
    const productId = await createProduct(schema, fx, { [fx.branchA]: { M: 5 }, [fx.branchB]: { M: 5 } });
    const userId = await createUser(schema, fx);
    const cart = app.get(CartService, { strict: false });
    await inTenantA(() => cart.addItem(userId, { productId, quantity: 2, size: 'M', branchId: fx.branchA }));
    await inTenantA(() => cart.addItem(userId, { productId, quantity: 1, size: 'M', branchId: fx.branchB }));
    const [a, b] = [await stockOf(schema, productId, fx.branchA, 'M'), await stockOf(schema, productId, fx.branchB, 'M')];
    // Las 3 unidades del ítem quedan reservadas en B y A recupera las suyas
    assert.deepEqual([a?.stock, b?.stock], [5, 2]);
  });
});
