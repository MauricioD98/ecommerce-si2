import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { withSql } from './support/world';

// Aplica la migración sobre un schema real en su estado ANTERIOR, con datos heredados
const SCHEMA = 'tenant_33333333333343338333333333333333';
const NEW_MIGRATION = '20261103120000_checkout_resilience';
const dir = join(__dirname, '..', '..', '..', 'prisma', 'migrations');

describe('Migración y backfill de datos heredados', () => {
  const ids = {
    role: randomUUID(), user: randomUUID(), other: randomUUID(), category: randomUUID(), branch: randomUUID(),
    product: randomUUID(), negative: randomUUID(), activeCart: randomUUID(), oldCart: randomUUID(),
    item: randomUUID(), oldItem: randomUUID(), noBranchItem: randomUUID(), order: randomUUID(),
  };

  before(async () => {
    await withSql(async (c) => {
      await c.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await c.query(`CREATE SCHEMA "${SCHEMA}"`);
      await c.query(`SET search_path TO "${SCHEMA}"`);
      const previous = readdirSync(dir).filter((name) => /^\d/.test(name) && name < NEW_MIGRATION).sort();
      for (const name of previous) await c.query(readFileSync(join(dir, name, 'migration.sql'), 'utf8'));

      // Dos carritos activos del mismo usuario y filas que el código viejo pudo dejar
      await c.query(`INSERT INTO roles (id,name,permissions,"updatedAt") VALUES ($1,'CLIENTE','{}',now())`, [ids.role]);
      for (const user of [ids.user, ids.other]) {
        await c.query(`INSERT INTO users (id,email,password,"roleId","updatedAt") VALUES ($1,$2,'x',$3,now())`, [user, `${user}@t.local`, ids.role]);
      }
      await c.query(`INSERT INTO categories (id,name,slug,"updatedAt") VALUES ($1,'C','c',now())`, [ids.category]);
      await c.query(`INSERT INTO branches (id,name,"updatedAt") VALUES ($1,'B',now())`, [ids.branch]);
      await c.query(`INSERT INTO products (id,name,sizes,price,stock,sku,"categoryId","updatedAt") VALUES ($1,'P','{M}',100,7,'S1',$2,now())`, [ids.product, ids.category]);
      await c.query(`INSERT INTO products (id,name,sizes,price,stock,sku,"categoryId","updatedAt") VALUES ($1,'N','{M}',100,0,'S2',$2,now())`, [ids.negative, ids.category]);
      await c.query(`INSERT INTO product_inventories (id,size,stock,"productId","branchId","updatedAt") VALUES ($1,'M',3,$2,$3,now())`, [randomUUID(), ids.product, ids.branch]);
      await c.query(`INSERT INTO product_inventories (id,size,stock,"productId","branchId","updatedAt") VALUES ($1,'M',-2,$2,$3,now())`, [randomUUID(), ids.negative, ids.branch]);
      await c.query(`INSERT INTO carts (id,"userId",checkout,"createdAt","updatedAt") VALUES ($1,$2,false,now()-interval '2 days',now()-interval '2 days')`, [ids.oldCart, ids.user]);
      await c.query(`INSERT INTO carts (id,"userId",checkout,"updatedAt") VALUES ($1,$2,false,now())`, [ids.activeCart, ids.user]);
      await c.query(`INSERT INTO cart_items (id,quantity,size,"branchId","productId","cartId") VALUES ($1,2,'M',$2,$3,$4)`, [ids.item, ids.branch, ids.product, ids.activeCart]);
      await c.query(`INSERT INTO cart_items (id,quantity,size,"branchId","productId","cartId") VALUES ($1,1,'M',$2,$3,$4)`, [ids.oldItem, ids.branch, ids.product, ids.oldCart]);
      await c.query(`INSERT INTO cart_items (id,quantity,size,"branchId","productId","cartId") VALUES ($1,1,NULL,NULL,$2,$3)`, [ids.noBranchItem, ids.negative, ids.activeCart]);
      await c.query(
        `INSERT INTO orders (id,"orderNumber","totalAmount","userId",status,"paymentStatus","stripePaymentIntentId","branchId","updatedAt") VALUES ($1,'ON-1',100,$2,'PENDIENTE','PENDIENTE','pi_legacy',$3,now())`,
        [ids.order, ids.other, ids.branch],
      );
      await c.query(`INSERT INTO payments (id,amount,currency,"userId","orderId","transactionId","updatedAt") VALUES ($1,100,'usd',$2,$3,'pi_legacy',now())`, [randomUUID(), ids.other, ids.order]);

      await c.query(readFileSync(join(dir, NEW_MIGRATION, 'migration.sql'), 'utf8'));
      await c.query('SET search_path TO public');
    });
  });
  after(() => withSql((c) => c.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`)));

  const q = (text: string, params: unknown[] = []) => withSql<any[]>(async (c) => (await c.query(text.replaceAll('$S', `"${SCHEMA}"`), params as never[])).rows);

  it('registra las reservas de los carritos SIN volver a descontar stock', async () => {
    const [row] = await q(`SELECT stock FROM $S.product_inventories WHERE "productId"=$1`, [ids.product]);
    assert.equal(row.stock, 3, 'los carritos ya habían descontado: el stock no cambia');
    const reservations = await q(`SELECT * FROM $S.stock_reservations WHERE "productId"=$1 ORDER BY quantity DESC`, [ids.product]);
    assert.equal(reservations.length, 2);
    assert.deepEqual(reservations.map((r) => [r.status, r.quantity, r.cartItemId]), [['ACTIVE', 2, ids.item], ['ACTIVE', 1, ids.oldItem]]);
  });

  it('deja un solo carrito activo y registra el duplicado, que queda vencido para el barrido', async () => {
    const carts = await q(`SELECT id,"activeUserId" FROM $S.carts WHERE "userId"=$1`, [ids.user]);
    assert.equal(carts.filter((cart) => cart.activeUserId).length, 1);
    assert.equal(carts.find((cart) => cart.activeUserId).id, ids.activeCart);
    const [issue] = await q(`SELECT * FROM $S.operational_issues WHERE type='LEGACY_DUPLICATE_ACTIVE_CART'`);
    assert.equal(issue.details.cartId, ids.oldCart);
    const [old] = await q(`SELECT "expiresAt" FROM $S.stock_reservations WHERE "cartItemId"=$1`, [ids.oldItem]);
    assert.ok(new Date(old.expiresAt).getTime() <= Date.now());
  });

  it('audita sin corregir: stock negativo, agregado desfasado y línea sin sucursal', async () => {
    const [negative] = await q(`SELECT stock FROM $S.product_inventories WHERE "productId"=$1`, [ids.negative]);
    assert.equal(negative.stock, -2, 'no se inventa stock para cuadrar');
    const types = (await q(`SELECT DISTINCT type FROM $S.operational_issues`)).map((r) => r.type);
    for (const type of ['LEGACY_NEGATIVE_STOCK', 'LEGACY_AGGREGATE_MISMATCH', 'LEGACY_CART_ITEM_UNRESERVED']) {
      assert.ok(types.includes(type), `falta ${type}`);
    }
    await assert.rejects(q(`UPDATE $S.product_inventories SET stock=-5 WHERE "productId"=$1`, [ids.product]));
  });

  it('crea intentos de pago para los cobros abiertos y da plazo de gracia a las órdenes pendientes', async () => {
    const [attempt] = await q(`SELECT * FROM $S.payment_attempts WHERE "orderId"=$1`, [ids.order]);
    assert.deepEqual([attempt.status, attempt.stripePaymentIntentId, attempt.amountMinor, attempt.idempotencyKey.startsWith('legacy-')], ['OPEN', 'pi_legacy', 10000, true]);
    const [order] = await q(`SELECT "paymentExpiresAt" FROM $S.orders WHERE id=$1`, [ids.order]);
    assert.ok(new Date(order.paymentExpiresAt).getTime() > Date.now() + 23 * 3600 * 1000);
  });
});
