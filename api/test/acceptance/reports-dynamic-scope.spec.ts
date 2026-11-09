import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Client } from 'pg';
import { Api, TENANT_A, TENANT_B, bootApp, queryRows, seedTenant, withSql, type Fixture } from './support/world';
import { acceptanceDatabaseUrl } from './support/env';
import { TenantResolutionCache } from '../../src/tenancy/tenant-resolution-cache.service';
import { ReportsService } from '../../src/modules/reports/reports.service';
import { REPORT_VIEWS, REPORT_WRAPPER_PREFIX, REPORT_WRAPPER_SUFFIX, validateGeneratedSql } from '../../src/modules/reports/sql-guard';

// Reportes dinámicos con IA (POST /reports/dynamic): alcance por tienda/sucursal garantizado por la BASE,
// aislamiento entre tiendas y validador sintáctico. El modelo NO se llama: generateSql se reemplaza
// por el SQL de cada prueba ("lo que respondería la IA"); validador, roles y ejecución son los reales.
// Para que los permisos sean los de producción, la base de pruebas debe pertenecer a un usuario SIN
// superusuario y con CREATEROLE (como neondb_owner en Neon): la suite lo comprueba antes de empezar.

const PAID = `('PROCESANDO','ENVIADO','ENTREGADO')`;
const DAY = 24 * 60 * 60 * 1000;
const RUNNER = 'stella_report_runner';

type Outcome = { rows: Record<string, unknown>[] } | { error: string };
const rowsOf = (o: Outcome) => {
  if ('error' in o) throw new Error(`Se esperaban filas: ${o.error}`);
  return o.rows;
};
const errorOf = (o: Outcome) => ('error' in o ? o.error : `sin error: ${JSON.stringify(o.rows)}`);

describe('Reportes con IA: alcance por sucursal y validador', () => {
  let app: INestApplication;
  let base: string;
  let fxA: Fixture;
  let fxB: Fixture;
  let appUser = '';
  let nextSql = '';
  const ids: Record<string, string> = {};
  // Todo lo que inserta la suite, para borrarlo al final: otras suites (p. ej. sales-forecast) cuentan
  // los pedidos de las mismas tiendas
  const created = {
    orders: [] as [string, string][],
    products: [] as [string, string][],
    categories: [] as [string, string][],
    users: [] as [string, string][],
    branches: [] as [string, string][],
  };
  // Conteos de referencia calculados SIEMPRE desde las tablas base: otras suites dejan datos en las tiendas
  const countIn = async (schema: string) => (await queryRows<{ n: number }>(`SELECT count(*)::int n FROM ${schema}.orders`))[0].n;

  const sA = `"${TENANT_A.schemaName}"`;
  const sB = `"${TENANT_B.schemaName}"`;
  const reportingA = `${TENANT_A.schemaName}_reporting`;
  const reportingB = `${TENANT_B.schemaName}_reporting`;

  const token = (tenantId: string, permissions: string[], branchId: string | null) =>
    app.get(JwtService, { strict: false }).sign(
      { sub: randomUUID(), email: 'r@test.local', role: { id: randomUUID(), name: 'Gerente' }, permissions, branchId, tenantId },
      { secret: process.env.JWT_SECRET, expiresIn: 3600 },
    );
  const api = (tenantId: string, permissions: string[], branchId: string | null = null) => new Api(base, tenantId, token(tenantId, permissions, branchId));
  const GLOBAL = ['VIEW_REPORTS', 'ALL_BRANCHES'];
  const BRANCH = ['VIEW_REPORTS'];

  // Lo que "respondería la IA" para la próxima pregunta
  const ask = async (client: Api, sql: string) => {
    nextSql = sql;
    return client.call('POST', '/reports/dynamic', { body: { prompt: 'pregunta de prueba' } });
  };
  const num = (value: unknown) => Number(value);

  // Conexión con el MISMO usuario que la API (no superusuario)
  const asAppUser = async <T>(fn: (c: Client) => Promise<T>): Promise<T> => {
    const c = new Client({ connectionString: acceptanceDatabaseUrl() });
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.end();
    }
  };
  const branchScope = (schema: string, branchId: string) =>
    asAppUser(async (c) => (await c.query(`SELECT "${schema}".ensure_report_branch_scope($1) AS name`, [branchId])).rows[0].name as string);

  // Reproduce ReportsService.executeReadOnly SIN el validador: concede el ámbito en la transacción y
  // ejecuta cada SQL dentro de report_runtime.run_report (con savepoints para seguir tras un error).
  const runInScope = (scopeSchema: string, branchSetting: string, statements: string[]) =>
    asAppUser(async (c) => {
      const results: Outcome[] = [];
      await c.query('BEGIN');
      await c.query(`GRANT USAGE ON SCHEMA "${scopeSchema}" TO ${RUNNER}`);
      await c.query(`GRANT SELECT ON ALL TABLES IN SCHEMA "${scopeSchema}" TO ${RUNNER}`);
      await c.query('SET LOCAL transaction_read_only = on');
      await c.query(`SELECT set_config('app.branch_id', $1, true)`, [branchSetting]);
      await c.query(`SET LOCAL search_path = "${scopeSchema}"`);
      await c.query(`SET LOCAL statement_timeout = '5s'`);
      for (const statement of statements) {
        await c.query('SAVEPOINT s');
        try {
          const { rows } = await c.query('SELECT report_row FROM report_runtime.run_report($1, $2) AS report_row', [statement, 500]);
          results.push({ rows: rows.map((r) => r.report_row) });
          await c.query('RELEASE SAVEPOINT s');
        } catch (error) {
          results.push({ error: (error as Error).message });
          await c.query('ROLLBACK TO SAVEPOINT s');
        }
      }
      await c.query('ROLLBACK');
      return results;
    });

  const setPlan = async (tenantId: string, plan: string) => {
    await queryRows('UPDATE public.tenants SET plan=$2 WHERE id=$1', [tenantId, plan]);
    app.get(TenantResolutionCache, { strict: false }).invalidate(tenantId);
  };

  before(async () => {
    const [me] = await queryRows<{ rolname: string; rolsuper: boolean; rolcreaterole: boolean }>(
      'SELECT rolname, rolsuper, rolcreaterole FROM pg_roles WHERE rolname = current_user',
    );
    assert.equal(me.rolsuper, false, 'ACCEPTANCE_DATABASE_URL debe usar un usuario SIN superusuario para esta suite');
    assert.equal(me.rolcreaterole, true, 'el usuario de la base debe tener CREATEROLE, como neondb_owner en Neon');
    appUser = me.rolname;

    app = await bootApp();
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    const service = app.get(ReportsService, { strict: false }) as unknown as { generateSql: () => Promise<string> };
    service.generateSql = async () => nextSql;

    fxA = await seedTenant(TENANT_A.schemaName);
    fxB = await seedTenant(TENANT_B.schemaName);
    await setPlan(TENANT_A.tenantId, 'pro');
    await setPlan(TENANT_B.tenantId, 'pro');

    await withSql(async (c) => {
      const cat = async (s: string, name: string) => {
        const id = randomUUID();
        await c.query(`INSERT INTO ${s}.categories (id,name,slug,"updatedAt") VALUES ($1,$2,$3,now())`, [id, name, `${name}-${id}`]);
        created.categories.push([s, id]);
        return id;
      };
      const product = async (s: string, name: string, price: number, categoryId: string) => {
        const id = randomUUID();
        await c.query(
          `INSERT INTO ${s}.products (id,name,sizes,price,stock,sku,"categoryId","updatedAt") VALUES ($1,$2,'{S,M}',$3,10,$4,$5,now())`,
          [id, name, price, `SKU-${id}`, categoryId],
        );
        created.products.push([s, id]);
        return id;
      };
      const user = async (s: string, roleId: string, first: string) => {
        const id = randomUUID();
        await c.query(`INSERT INTO ${s}.users (id,email,password,"firstName","lastName","roleId","updatedAt") VALUES ($1,$2,'x',$3,'Test',$4,now())`, [
          id,
          `${id}@test.local`,
          first,
          roleId,
        ]);
        created.users.push([s, id]);
        return id;
      };
      const order = async (s: string, userId: string, branchId: string, status: string, daysAgo: number, items: [string, number, number, string][]) => {
        const id = randomUUID();
        const total = items.reduce((sum, [, qty, price]) => sum + qty * price, 0);
        await c.query(
          `INSERT INTO ${s}.orders (id,"orderNumber",status,"totalAmount","userId","branchId","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,now())`,
          [id, `R-${id}`, status, total, userId, branchId, new Date(Date.now() - daysAgo * DAY)],
        );
        created.orders.push([s, id]);
        for (const [productId, qty, price, size] of items) {
          await c.query(
            `INSERT INTO ${s}.order_items (id,quantity,price,size,"productId","orderId","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now())`,
            [randomUUID(), qty, price, size, productId, id],
          );
        }
        return id;
      };

      const deportivo = await cat(sA, 'Deportivo');
      const blusas = await cat(sA, 'Blusas');
      ids.set = await product(sA, 'Set Deportivo', 180, deportivo);
      ids.blusa = await product(sA, 'Blusa Lino', 100, blusas);
      const ana = await user(sA, fxA.roleId, 'Ana');
      const luis = await user(sA, fxA.roleId, 'Luis');
      // Sucursal A (fxA.branchA)
      await order(sA, ana, fxA.branchA, 'ENTREGADO', 1, [[ids.set, 2, 180, 'M'], [ids.blusa, 1, 100, 'S']]);
      await order(sA, luis, fxA.branchA, 'PROCESANDO', 2, [[ids.set, 1, 180, 'L']]);
      await order(sA, ana, fxA.branchA, 'PENDIENTE', 1, [[ids.blusa, 3, 100, 'M']]);
      await order(sA, luis, fxA.branchA, 'CANCELADO', 3, [[ids.set, 5, 180, 'M']]);
      // Sucursal B de la misma tienda (fxA.branchB): un monto único (7 x 777 = 5439) para detectar fugas
      await order(sA, luis, fxA.branchB, 'ENTREGADO', 1, [[ids.set, 4, 180, 'S']]);
      await order(sA, luis, fxA.branchB, 'ENVIADO', 1, [[ids.blusa, 7, 777, 'M']]);
      // Otra tienda
      const bCat = await cat(sB, 'Secreta');
      const bProduct = await product(sB, 'Producto B Secreto', 9999, bCat);
      const beatriz = await user(sB, fxB.roleId, 'Beatriz');
      await order(sB, beatriz, fxB.branchA, 'ENTREGADO', 1, [[bProduct, 1, 9999, 'M']]);
    });
  });

  after(async () => {
    await withSql(async (c) => {
      for (const [s, id] of created.orders) {
        await c.query(`DELETE FROM ${s}.order_items WHERE "orderId"=$1`, [id]);
        await c.query(`DELETE FROM ${s}.orders WHERE id=$1`, [id]);
      }
      for (const [s, id] of created.products) await c.query(`DELETE FROM ${s}.products WHERE id=$1`, [id]);
      for (const [s, id] of created.categories) await c.query(`DELETE FROM ${s}.categories WHERE id=$1`, [id]);
      for (const [s, id] of created.users) await c.query(`DELETE FROM ${s}.users WHERE id=$1`, [id]);
      for (const [s, id] of created.branches) await c.query(`DELETE FROM ${s}.branches WHERE id=$1`, [id]);
    }).catch((error) => console.error('Limpieza de reports-dynamic-scope incompleta:', error));
    await setPlan(TENANT_A.tenantId, 'free').catch(() => undefined);
    await setPlan(TENANT_B.tenantId, 'free').catch(() => undefined);
    await app?.close();
  });

  // -------------------------------------------------------------------------------------------
  describe('validador sintáctico', () => {
    const accepts = async (sql: string) => assert.equal(typeof (await validateGeneratedSql(sql)), 'string', sql);
    const rejects = async (sql: string, reason?: RegExp) =>
      assert.rejects(validateGeneratedSql(sql), (error: Error) => {
        assert.match(error.message, /no está permitida/);
        if (reason) assert.match(error.message, reason);
        return true;
      }, sql);

    it('acepta literales con palabras que antes eran "prohibidas"', async () => {
      await accepts(`SELECT sum(cantidad) AS unidades FROM rendimiento_productos WHERE producto ILIKE '%set deportivo%'`);
      await accepts(`SELECT count(*) AS n FROM orders WHERE order_number <> 'do' AND status <> 'public; DROP TABLE x' AND fulfillment_type <> 'insert into update delete'`);
      await accepts(`SELECT 'No puedo responder esa pregunta con los datos disponibles' AS mensaje`);
      await accepts('```sql\nSELECT count(*) AS n FROM orders;\n```');
      await accepts('SELECT count(*) AS n FROM orders -- comentario final');
    });

    it('acepta JOIN de 6+ vistas, WITH, ventanas, HAVING, UNION y AT TIME ZONE', async () => {
      await accepts(`
        WITH ventas AS (
          SELECT o.id, o.branch_id, o.user_id, o.created_at FROM orders o WHERE o.status IN ${PAID}
        )
        SELECT b.name AS sucursal, c.name AS categoria, count(DISTINCT v.id) AS pedidos, sum(oi.quantity) AS unidades,
               rank() OVER (PARTITION BY b.name ORDER BY sum(oi.quantity) DESC) AS puesto,
               max(extract(year FROM v.created_at AT TIME ZONE 'UTC')) AS anio
        FROM ventas v
        JOIN order_items oi ON oi.order_id = v.id
        JOIN products p ON p.id = oi.product_id
        JOIN categories c ON c.id = p.category_id
        JOIN branches b ON b.id = v.branch_id
        JOIN users u ON u.id = v.user_id
        LEFT JOIN product_inventories pi ON pi.product_id = p.id AND pi.branch_id = v.branch_id
        WHERE v.created_at >= now() - interval '30 days' AND trim(u.first_name) <> ''
        GROUP BY b.name, c.name
        HAVING sum(oi.quantity) >= 1
        UNION ALL
        SELECT 'total', NULL, count(*), NULL, NULL, NULL FROM ventas_globales WHERE canal = 'POS'
        ORDER BY 1 LIMIT 100`);
      await accepts(`SELECT x::numeric(10,2) AS a, cast(y AS date) AS b, coalesce(z, 0) AS c, greatest(a, b) AS d FROM orders`);
    });

    it('rechaza escrituras', async () => {
      await rejects(`UPDATE orders SET status = 'ENTREGADO'`, /solo se permiten consultas SELECT/);
      await rejects(`DELETE FROM orders`, /solo se permiten consultas SELECT/);
      await rejects(`WITH x AS (UPDATE orders SET status = 'X' RETURNING 1) SELECT * FROM x`, /solo se permite SELECT dentro de WITH/);
      await rejects(`WITH x AS (INSERT INTO orders (id) VALUES ('1') RETURNING 1) SELECT * FROM x`, /solo se permite SELECT dentro de WITH/);
      await rejects(`SELECT * INTO copia FROM orders`, /SELECT INTO/);
      await rejects(`SELECT * FROM orders FOR UPDATE`, /bloqueo/);
      await rejects(`SELECT 1; DELETE FROM orders`, /más de una sentencia/);
      await rejects(`SELECT 1; SELECT 2`, /más de una sentencia/);
    });

    it('rechaza funciones no permitidas, cambios de rol y metadatos', async () => {
      await rejects(`SELECT set_config('app.branch_id', '*', true)`, /función no permitida: set_config/);
      await rejects(`SELECT set_config('role', 'none', true)`, /función no permitida: set_config/);
      await rejects(`SELECT pg_catalog.set_config('role', 'x', true)`, /funciones con schema/);
      await rejects(`SELECT current_setting('app.branch_id')`, /función no permitida/);
      await rejects(`SELECT pg_sleep(10)`, /función no permitida/);
      await rejects(`SELECT query_to_xml('select 1', true, true, '')`, /función no permitida/);
      await rejects(`SELECT table_to_xml('orders', true, true, '')`, /función no permitida/);
      await rejects(`SELECT pg_read_file('/etc/passwd')`, /función no permitida/);
      await rejects(`SELECT current_user AS u`, /función del sistema/);
      await rejects(`SELECT session_user AS u`, /función del sistema/);
      await rejects(`SELECT 'orders'::regclass`, /tipo de dato no permitido/);
      await rejects(`SELECT * FROM orders WHERE id = $1`, /ParamRef/);
    });

    it('rechaza tablas, schemas y catálogos no autorizados (también disfrazados de WITH)', async () => {
      await rejects(`SELECT * FROM payments`, /vista no permitida: payments/);
      await rejects(`SELECT * FROM pg_settings`, /vista no permitida/);
      await rejects(`SELECT * FROM information_schema.tables`, /schema/);
      await rejects(`SELECT * FROM ${reportingB}.orders`, /schema/);
      await rejects(`SELECT * FROM ${TENANT_A.schemaName}.users`, /schema/);
      await rejects(`SELECT * FROM report_runtime.run_report('select 1', 1)`, /schema/);
      await rejects(`SELECT * FROM "Orders"`, /vista no permitida/);
      // Sin RECURSIVE, "secretos" dentro de "a" sería una relación real, no la CTE posterior
      await rejects(`WITH a AS (SELECT * FROM secretos), secretos AS (SELECT 1) SELECT * FROM a`, /vista no permitida: secretos/);
      await rejects(`WITH pg_roles AS (SELECT 1) SELECT * FROM pg_roles`, /reservado/);
      // Una CTE de una subconsulta no se ve fuera de ella
      await rejects(`SELECT * FROM (WITH t AS (SELECT 1) SELECT * FROM t) x, t`, /vista no permitida: t/);
    });

    it('no se puede "escapar" del envoltorio que arma la base', async () => {
      // Válido solo y como subconsulta: el envoltorio debe seguir siendo una sola consulta
      await rejects(`SELECT 1 AS x) AS report_result LIMIT 1; SELECT (1`);
      assert.match(REPORT_WRAPPER_PREFIX, /^SELECT to_json\(report_result\) FROM \(\n$/);
      assert.equal(REPORT_WRAPPER_SUFFIX, '\n) AS report_result LIMIT $1');
      // El texto de la función en la base usa el mismo envoltorio
      const [{ src }] = await queryRows<{ src: string }>(`SELECT prosrc src FROM pg_proc WHERE proname = 'run_report'`);
      assert.match(src, /'SELECT to_json\(report_result\) FROM \(' \|\| chr\(10\) \|\| p_sql \|\| chr\(10\) \|\| '\) AS report_result LIMIT \$1'/);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('por HTTP', () => {
    it('pregunta legítima por «Set Deportivo»: unidades pagadas exactas', async () => {
      const res = await ask(
        api(TENANT_A.tenantId, GLOBAL),
        `SELECT sum(cantidad) AS unidades FROM rendimiento_productos WHERE producto ILIKE '%set deportivo%' AND estado_pedido IN ${PAID}`,
      );
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const [{ n }] = await queryRows(
        `SELECT sum(oi.quantity)::int n FROM ${sA}.order_items oi JOIN ${sA}.orders o ON o.id=oi."orderId" WHERE oi."productId"=$1 AND o.status::text IN ${PAID}`,
        [ids.set],
      );
      assert.equal(num(res.body.rows[0].unidades), n);
      assert.equal(n, 7); // 2 + 1 (sucursal A) + 4 (sucursal B); el CANCELADO no cuenta
    });

    it('consulta con 6 vistas, GROUP BY y HAVING: mismos números y orden de columnas que las tablas base', async () => {
      const sql = `
        SELECT b.name AS sucursal, c.name AS categoria, count(DISTINCT o.id) AS pedidos, sum(oi.quantity) AS unidades
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        JOIN products p ON p.id = oi.product_id
        JOIN categories c ON c.id = p.category_id
        JOIN branches b ON b.id = o.branch_id
        JOIN users u ON u.id = o.user_id
        WHERE o.status IN ${PAID}
        GROUP BY b.name, c.name
        HAVING sum(oi.quantity) >= 2
        ORDER BY sucursal, categoria`;
      const res = await ask(api(TENANT_A.tenantId, GLOBAL), sql);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual(res.body.columns, ['sucursal', 'categoria', 'pedidos', 'unidades']);
      const expected = await queryRows(
        `SELECT b.name sucursal, c.name categoria, count(DISTINCT o.id)::int pedidos, sum(oi.quantity)::int unidades
         FROM ${sA}.orders o JOIN ${sA}.order_items oi ON oi."orderId"=o.id JOIN ${sA}.products p ON p.id=oi."productId"
         JOIN ${sA}.categories c ON c.id=p."categoryId" JOIN ${sA}.branches b ON b.id=o."branchId"
         WHERE o.status::text IN ${PAID} GROUP BY b.name, c.name HAVING sum(oi.quantity) >= 2 ORDER BY 1, 2`,
      );
      assert.deepEqual(
        res.body.rows.map((r: any) => ({ ...r, pedidos: num(r.pedidos), unidades: num(r.unidades) })),
        expected,
      );
      assert.ok(expected.length >= 2, 'el caso debe cubrir varias sucursales');
    });

    it('una consulta que termina en comentario funciona de punta a punta', async () => {
      const res = await ask(api(TENANT_A.tenantId, GLOBAL), 'SELECT count(*) AS n FROM orders -- total');
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(num(res.body.rows[0].n), await countIn(sA));
    });

    it('usuario de UNA sucursal: solo ve la suya, aunque pida otra o todas', async () => {
      const branchUser = api(TENANT_A.tenantId, BRANCH, fxA.branchA);
      const [{ own }] = await queryRows(`SELECT count(*)::int own FROM ${sA}.orders WHERE "branchId"=$1`, [fxA.branchA]);

      const all = await ask(branchUser, `SELECT count(*) AS n, count(DISTINCT branch_id) AS sucursales FROM orders`);
      assert.equal(all.status, 200, JSON.stringify(all.body));
      assert.deepEqual([num(all.body.rows[0].n), num(all.body.rows[0].sucursales)], [own, 1]);

      const other = await ask(branchUser, `SELECT count(*) AS n FROM ventas_globales WHERE branch_id = '${fxA.branchB}'`);
      assert.equal(num(other.body.rows[0].n), 0);
      const leak = await ask(branchUser, `SELECT count(*) AS n FROM rendimiento_productos WHERE precio_unitario = 777`);
      assert.equal(num(leak.body.rows[0].n), 0);
      const branches = await ask(branchUser, `SELECT id FROM branches`);
      assert.deepEqual(branches.body.rows, [{ id: fxA.branchA }]);
      const customers = await ask(branchUser, `SELECT count(*) AS n FROM users`);
      const [{ buyers }] = await queryRows(`SELECT count(DISTINCT "userId")::int buyers FROM ${sA}.orders WHERE "branchId"=$1`, [fxA.branchA]);
      assert.equal(num(customers.body.rows[0].n), buyers);
    });

    it('usuario con ALL_BRANCHES: ve todas las sucursales de SU tienda', async () => {
      const res = await ask(api(TENANT_A.tenantId, GLOBAL), `SELECT count(*) AS n, count(DISTINCT branch_id) AS sucursales FROM orders`);
      const [{ total, sucursales }] = await queryRows(`SELECT count(*)::int total, count(DISTINCT "branchId")::int sucursales FROM ${sA}.orders`);
      assert.deepEqual([num(res.body.rows[0].n), num(res.body.rows[0].sucursales)], [total, sucursales]);
      assert.ok(sucursales >= 2);
      const secret = await ask(api(TENANT_A.tenantId, GLOBAL), `SELECT count(*) AS n FROM rendimiento_productos WHERE precio_unitario = 777`);
      assert.equal(num(secret.body.rows[0].n), 1);
    });

    it('una tienda no ve datos de otra', async () => {
      const bGlobal = await ask(api(TENANT_B.tenantId, GLOBAL), `SELECT count(*) AS n FROM orders`);
      assert.equal(num(bGlobal.body.rows[0].n), await countIn(sB));
      const bSecret = await ask(api(TENANT_B.tenantId, GLOBAL), `SELECT count(*) AS n FROM products WHERE name = 'Producto B Secreto'`);
      assert.equal(num(bSecret.body.rows[0].n), 1);
      const aGlobal = await ask(api(TENANT_A.tenantId, GLOBAL), `SELECT count(*) AS n FROM products WHERE name = 'Producto B Secreto'`);
      assert.equal(num(aGlobal.body.rows[0].n), 0);
      // Token de la tienda A con el header de la tienda B
      const cross = await new Api(base, TENANT_B.tenantId, token(TENANT_A.tenantId, GLOBAL, null)).call('POST', '/reports/dynamic', {
        body: { prompt: 'x' },
      });
      assert.equal(cross.status, 401);
    });

    it('intentos de cambiar sucursal o rol desde la consulta se rechazan con 403', async () => {
      const branchUser = api(TENANT_A.tenantId, BRANCH, fxA.branchA);
      for (const sql of [
        `SELECT count(*) AS n FROM orders, (SELECT set_config('app.branch_id', '*', true)) x`,
        `SELECT set_config('role', 'none', true) AS r, query_to_xml('select count(*) from ${sB}.orders', true, true, '') AS x`,
        `SELECT pg_catalog.set_config('role', '${appUser}', true)`,
        `SELECT count(*) AS n FROM ${reportingA}.orders`,
        `SELECT * FROM report_runtime.run_report('select 1', 1)`,
      ]) {
        const res = await ask(branchUser, sql);
        assert.equal(res.status, 403, sql);
        assert.match(res.body.message, /no está permitida/);
      }
    });

    it('escrituras, funciones y tablas no autorizadas devuelven 403; nada cambia', async () => {
      const [{ before: entregados }] = await queryRows(`SELECT count(*)::int before FROM ${sA}.orders WHERE status='ENTREGADO'`);
      for (const sql of [
        `WITH x AS (UPDATE orders SET status = 'ENTREGADO' RETURNING 1) SELECT count(*) FROM x`,
        `SELECT pg_sleep(30)`,
        `SELECT * FROM payments`,
        `SELECT * FROM ${reportingB}.orders`,
      ]) {
        assert.equal((await ask(api(TENANT_A.tenantId, GLOBAL), sql)).status, 403, sql);
      }
      const [{ after: ahora }] = await queryRows(`SELECT count(*)::int after FROM ${sA}.orders WHERE status='ENTREGADO'`);
      assert.equal(ahora, entregados);
    });

    it('mantiene el límite de filas y el de tiempo', async () => {
      const many = await ask(api(TENANT_A.tenantId, GLOBAL), `SELECT g AS n FROM generate_series(1, 5000) g`);
      assert.equal(many.status, 200);
      assert.equal(many.body.rowCount, 500);
      const t0 = Date.now();
      const slow = await ask(api(TENANT_A.tenantId, GLOBAL), `SELECT count(*) AS n FROM generate_series(1, 2000000000) g`);
      assert.equal(slow.status, 400);
      assert.ok(Date.now() - t0 < 15_000, 'statement_timeout de 5 s');
    });

    it('sucursal asignada inexistente: 403 claro y no se ejecuta nada', async () => {
      const res = await ask(api(TENANT_A.tenantId, BRANCH, randomUUID()), `SELECT count(*) AS n FROM orders`);
      assert.equal(res.status, 403);
      assert.match(res.body.message, /sucursal asignada no existe/);
    });

    it('peticiones simultáneas del mismo ámbito y de una sucursal nueva', async () => {
      const fresh = randomUUID();
      await queryRows(`INSERT INTO ${sA}.branches (id,name,"updatedAt") VALUES ($1,'Nueva',now())`, [fresh]);
      created.branches.push([sA, fresh]);
      nextSql = `SELECT count(*) AS n FROM orders`;
      const calls = [
        ...Array.from({ length: 6 }, () => api(TENANT_A.tenantId, BRANCH, fresh)),
        ...Array.from({ length: 6 }, () => api(TENANT_A.tenantId, GLOBAL)),
      ].map((client) => client.call('POST', '/reports/dynamic', { body: { prompt: 'x' } }));
      const responses = await Promise.all(calls);
      const total = await countIn(sA);
      responses.forEach((res, i) => {
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.equal(num(res.body.rows[0].n), i < 6 ? 0 : total);
      });
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('roles y permisos de la conexión', () => {
    it('ningún rol por tienda ni por sucursal: solo el ejecutor global, sin login ni privilegios', async () => {
      // Los de A y B los eliminó su migración y ya no se crean roles por sucursal. (migration-backfill.spec
      // deja a propósito un schema migrado solo hasta antes de esta migración, con sus roles viejos.)
      const perScope = await queryRows(`SELECT rolname FROM pg_roles WHERE rolname = ANY($1) OR rolname ~ '^rb_[0-9a-f]{32}$'`, [
        [`reports_${TENANT_A.schemaName.slice(7)}`, `reports_${TENANT_B.schemaName.slice(7)}`],
      ]);
      assert.deepEqual(perScope, [], 'la migración elimina reports_<tienda> y no hay roles por sucursal');
      const [runner] = await queryRows(
        `SELECT rolsuper, rolcanlogin, rolinherit, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication,
                (SELECT count(*)::int FROM pg_auth_members m WHERE m.member = r.oid) AS es_miembro_de
         FROM pg_roles r WHERE rolname = $1`,
        [RUNNER],
      );
      assert.deepEqual(runner, {
        rolsuper: false, rolcanlogin: false, rolinherit: false, rolbypassrls: false,
        rolcreaterole: false, rolcreatedb: false, rolreplication: false, es_miembro_de: 0,
      });
    });

    it('el ejecutor no conserva permisos fuera de la transacción del reporte', async () => {
      await asAppUser((c) => c.query(`SELECT "${TENANT_A.schemaName}".ensure_report_branch_scope($1)`, [fxA.branchA]));
      const granted = await queryRows(
        `SELECT n.nspname FROM pg_namespace n
         WHERE has_schema_privilege($1::text, n.oid, 'USAGE') AND n.nspname !~ '^(pg_|information_schema$)'`,
        [RUNNER],
      );
      // public (plano de control) aparece solo si PUBLIC tiene USAGE; sus tablas igual exigen SELECT
      assert.deepEqual(granted.map((g) => g.nspname).filter((n) => n !== 'public'), []);
      const tables = await queryRows(
        `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind IN ('r','v','m','p') AND n.nspname !~ '^(pg_|information_schema$)' AND has_table_privilege($1::text, c.oid, 'SELECT')`,
        [RUNNER],
      );
      assert.deepEqual(tables, []);
    });

    it('session_user es la cuenta de la API; current_user, el ejecutor; la cuenta solo puede cambiar a él', async () => {
      const [inside] = await runInScope(reportingA, '*', [`SELECT session_user AS s, current_user AS c`]);
      assert.deepEqual(rowsOf(inside), [{ s: appUser, c: RUNNER }]);
      // Roles a los que la cuenta puede cambiar: el ejecutor y, como mucho, restos SIN ningún acceso a datos
      const targets = await queryRows<{ rolname: string; schemas: number; relations: number }>(
        `SELECT DISTINCT r.rolname,
                -- Objetos dentro de schemas que puede usar (un schema vacío sobrante no da acceso a nada;
                -- migration-backfill.spec deja "tenant_3333…_reporting" vacío al borrar su tienda)
                (SELECT count(*)::int FROM pg_namespace n JOIN pg_class c ON c.relnamespace = n.oid
                   WHERE n.nspname !~ '^(pg_|information_schema$|public$)'
                   AND has_schema_privilege(r.oid, n.oid, 'USAGE')) AS schemas,
                (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE c.relkind IN ('r','v','m','p') AND n.nspname !~ '^(pg_|information_schema$)'
                   AND has_table_privilege(r.oid, c.oid, 'SELECT')) AS relations
         FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid
         WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = $1) ORDER BY 1`,
        [appUser],
      );
      assert.ok(targets.some((t) => t.rolname === RUNNER));
      for (const t of targets) assert.deepEqual([t.rolname, t.schemas, t.relations], [t.rolname, 0, 0], 'rol con acceso a datos');
    });

    it('REGRESIÓN: volver al rol de la conexión y leer otra tienda con query_to_xml (antes funcionaba)', async () => {
      const results = await runInScope(reportingA, '*', [
        `SELECT set_config('role', 'none', true) AS r, query_to_xml('select count(*) from ${sB}.orders', true, true, '') AS x`,
        `SELECT set_config('role', '${appUser}', true) AS r`,
        `SELECT set_config('session_authorization', '${appUser}', true) AS r`,
        `SELECT query_to_xml('select count(*) from ${sB}.orders', true, true, '') AS x`,
        `SELECT query_to_xml('select count(*) from ${reportingB}.orders', true, true, '') AS x`,
        `SELECT table_to_xml('${sA}.users'::regclass, true, true, '') AS x`,
      ]);
      assert.match(errorOf(results[0]), /cannot set parameter "role" within security-definer function/);
      assert.match(errorOf(results[1]), /cannot set parameter "role" within security-definer function/);
      assert.match(errorOf(results[2]), /cannot set parameter "session_authorization"|permission denied/);
      for (const r of results.slice(3)) assert.match(errorOf(r), /permission denied/);
    });

    it('no se puede encadenar SET ROLE, salir del envoltorio ni volver a modo escritura', async () => {
      const results = await runInScope(reportingA, '*', [
        `SELECT 1 AS x) AS report_result; RESET ROLE; SELECT (1`,
        `SELECT 1 AS x) AS report_result; SET ROLE ${appUser}; SELECT (1`,
        `SELECT set_config('transaction_read_only', 'off', true) AS x`,
        `SELECT query_to_xml('UPDATE orders SET order_number = order_number RETURNING 1', true, true, '') AS x`,
        `SELECT session_user AS s, current_user AS c`,
      ]);
      for (const r of results.slice(0, 4)) assert.ok('error' in r, JSON.stringify(r));
      assert.deepEqual(rowsOf(results[4]), [{ s: appUser, c: RUNNER }], 'el rol sigue siendo el ejecutor');
    });

    it('cambiar app.branch_id (incluso a "*") no amplía el ámbito de sucursal', async () => {
      const rb = await branchScope(TENANT_A.schemaName, fxA.branchA);
      const [{ own }] = await queryRows(`SELECT count(*)::int own FROM ${sA}.orders WHERE "branchId"=$1`, [fxA.branchA]);
      const results = await runInScope(rb, fxA.branchA, [
        `SELECT count(*)::int AS n FROM orders, (SELECT set_config('app.branch_id', '*', true)) x`,
        `SELECT count(*)::int AS n FROM orders WHERE branch_id = '${fxA.branchB}'`,
        `SELECT set_config('search_path', '${reportingA}', true) AS sp, (SELECT count(*) FROM orders) AS n`,
      ]);
      assert.equal(rowsOf(results[0])[0].n, own);
      assert.equal(rowsOf(results[1])[0].n, 0);
      // search_path se resuelve al planificar: sigue leyendo el ámbito de la sucursal
      assert.equal(num(rowsOf(results[2])[0].n), own);
    });

    it('el ámbito de sucursal no lee la tienda completa, las tablas, el plano de control ni otra tienda', async () => {
      const rb = await branchScope(TENANT_A.schemaName, fxA.branchA);
      const rbOther = await branchScope(TENANT_A.schemaName, fxA.branchB);
      const rbStoreB = await branchScope(TENANT_B.schemaName, fxB.branchA);
      const results = await runInScope(rb, fxA.branchA, [
        `SELECT count(*) FROM ${reportingA}.orders`,
        `SELECT count(*) FROM ${sA}.users`,
        `SELECT count(*) FROM ${sA}.payments`,
        `SELECT count(*) FROM public.tenants`,
        `SELECT count(*) FROM "${rbOther}".orders`,
        `SELECT count(*) FROM ${reportingB}.orders`,
        `SELECT count(*) FROM "${rbStoreB}".orders`,
        `SELECT count(*) FROM ${sB}.orders`,
        `SELECT * FROM report_runtime.run_report('select 1', 1)`,
        `SELECT ${sA}.ensure_report_branch_scope('${fxA.branchB}')`,
        `SELECT ${sA}.prune_report_branch_scopes()`,
      ]);
      for (const r of results) assert.match(errorOf(r), /permission denied/);
    });

    it('el ámbito de tienda no lee otra tienda; la otra tienda ve solo lo suyo', async () => {
      const rbB = await branchScope(TENANT_B.schemaName, fxB.branchA);
      const results = await runInScope(reportingA, '*', [
        `SELECT count(*) FROM ${reportingB}.orders`,
        `SELECT count(*) FROM "${rbB}".orders`,
        `SELECT count(*) FROM ${sB}.orders`,
      ]);
      for (const r of results) assert.match(errorOf(r), /permission denied/);
      const [own] = await runInScope(reportingB, '*', [`SELECT count(*)::int AS n FROM orders`]);
      assert.equal(rowsOf(own)[0].n, await countIn(sB));
    });

    it('security_barrier: un error provocado no revela filas de otra sucursal', async () => {
      const rb = await branchScope(TENANT_A.schemaName, fxA.branchA);
      const probe = `SELECT count(*)::int AS n FROM orders WHERE 1 / (CASE WHEN total_amount = 5439 THEN 0 ELSE 1 END) = 1`;
      const [asBranch] = await runInScope(rb, fxA.branchA, [probe]);
      assert.ok('rows' in asBranch, JSON.stringify(asBranch));
      // Control: con el ámbito de toda la tienda la fila existe y la división falla
      const [asStore] = await runInScope(reportingA, '*', [probe]);
      assert.match(errorOf(asStore), /division by zero/);
    });

    it('la cuenta de la API no puede ejecutar run_report sin conceder antes el ámbito (no hay permisos fijos)', async () => {
      const error = await asAppUser(async (c) => {
        await c.query('BEGIN READ ONLY');
        await c.query(`SET LOCAL search_path = "${reportingA}"`);
        try {
          await c.query('SELECT * FROM report_runtime.run_report($1, $2)', ['SELECT count(*) FROM orders', 10]);
          return null;
        } catch (e) {
          return (e as Error).message;
        } finally {
          await c.query('ROLLBACK');
        }
      });
      // Sin USAGE, PostgreSQL ignora el schema del search_path: la vista "no existe" para el ejecutor
      assert.match(error ?? '', /permission denied|relation "orders" does not exist/);
      const [privs] = await queryRows(
        `SELECT has_function_privilege('public', 'report_runtime.run_report(text,integer)', 'EXECUTE') AS publico,
                has_schema_privilege('public', 'report_runtime', 'USAGE') AS publico_schema`,
      );
      assert.deepEqual(privs, { publico: false, publico_schema: false });
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('funciones de ámbito, limpieza y restauración', () => {
    it('ensure: idempotente, solo sucursales de SU tienda e inmune a ids maliciosos', async () => {
      const rb = await branchScope(TENANT_A.schemaName, fxA.branchA);
      assert.match(rb, /^rb_[0-9a-f]{32}$/);
      assert.equal(await branchScope(TENANT_A.schemaName, fxA.branchA), rb);
      for (const bad of [fxB.branchA, `x'); DROP SCHEMA ${sA} CASCADE; --`, '', 'a'.repeat(65)]) {
        await assert.rejects(branchScope(TENANT_A.schemaName, bad), /report_scope_(unknown|invalid)_branch/, bad);
      }
      const [{ n }] = await queryRows(`SELECT count(*)::int n FROM pg_namespace WHERE nspname = 'rb_' || md5($1 || ':' || $2)`, [
        TENANT_A.schemaName,
        fxB.branchA,
      ]);
      assert.equal(n, 0, 'no se creó ámbito para una sucursal de otra tienda');
      const [privs] = await queryRows(
        `SELECT has_function_privilege($1::text, $2::text, 'EXECUTE') AS runner_ensure,
                has_function_privilege('public', $2::text, 'EXECUTE') AS public_ensure,
                has_function_privilege($1::text, $3::text, 'EXECUTE') AS runner_prune,
                has_function_privilege('public', $3::text, 'EXECUTE') AS public_prune`,
        [RUNNER, `${sA}.ensure_report_branch_scope(text)`, `${sA}.prune_report_branch_scopes()`],
      );
      assert.deepEqual(privs, { runner_ensure: false, public_ensure: false, runner_prune: false, public_prune: false });
      const views = await queryRows<{ relname: string; barrier: boolean }>(
        `SELECT c.relname, coalesce('security_barrier=true' = ANY(c.reloptions), false) barrier
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind='v' ORDER BY 1`,
        [rb],
      );
      assert.deepEqual(views.map((v) => v.relname), [...REPORT_VIEWS].sort());
      assert.ok(views.every((v) => v.barrier));
    });

    it('borrar una sucursal (o que un respaldo la quite) elimina su ámbito; los de otras sucursales y tiendas quedan', async () => {
      const temp = randomUUID();
      await queryRows(`INSERT INTO ${sA}.branches (id,name,"updatedAt") VALUES ($1,'Temporal',now())`, [temp]);
      const rbTemp = await branchScope(TENANT_A.schemaName, temp);
      const rbKeep = await branchScope(TENANT_A.schemaName, fxA.branchA);
      const rbStoreB = await branchScope(TENANT_B.schemaName, fxB.branchA);
      // Schema con nombre de ámbito pero registro falsificado: prune no debe tocarlo
      const forged = `rb_${'0'.repeat(32)}`;
      await withSql(async (c) => {
        await c.query(`CREATE SCHEMA IF NOT EXISTS "${forged}"`);
        await c.query(`COMMENT ON SCHEMA "${forged}" IS 'report-branch-scope-v2:${TENANT_A.schemaName}:no-existe'`);
      });

      // Por la API (BranchesService.remove)
      const del = await api(TENANT_A.tenantId, ['MANAGE_BRANCHES', 'ALL_BRANCHES']).call('DELETE', `/branches/${temp}`);
      assert.ok([200, 204].includes(del.status), JSON.stringify(del.body));
      const left = await queryRows<{ nspname: string }>(`SELECT nspname FROM pg_namespace WHERE nspname = ANY($1)`, [[rbTemp, rbKeep, rbStoreB, forged]]);
      assert.deepEqual(left.map((l) => l.nspname).sort(), [rbKeep, rbStoreB, forged].sort());
      await withSql((c) => c.query(`DROP SCHEMA "${forged}"`));
    });

    it('restauración: si las vistas se recrean o la sucursal vuelve, el ámbito se reconstruye solo', async () => {
      const rb = await branchScope(TENANT_A.schemaName, fxA.branchA);
      // Recrear una vista base (como haría una migración o restauración que regenere las vistas)
      await withSql(async (c) => {
        const [{ def }] = (await c.query(`SELECT pg_get_viewdef($1::regclass) AS def`, [`${reportingA}.ventas_globales`])).rows;
        await c.query('BEGIN');
        await c.query(`DROP VIEW "${reportingA}".ventas_globales CASCADE`);
        await c.query(`CREATE VIEW "${reportingA}".ventas_globales AS ${def}`);
        await c.query('COMMIT');
      });
      const [{ views }] = await queryRows(`SELECT count(*)::int views FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind='v'`, [rb]);
      assert.equal(views, REPORT_VIEWS.size - 1, 'el CASCADE se llevó la vista de la sucursal');

      const res = await ask(api(TENANT_A.tenantId, BRANCH, fxA.branchA), `SELECT count(*) AS n FROM ventas_globales`);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const [{ own }] = await queryRows(`SELECT count(*)::int own FROM ${sA}.orders WHERE "branchId"=$1`, [fxA.branchA]);
      assert.equal(num(res.body.rows[0].n), own);
      // Y la vista global recreada sigue funcionando para ALL_BRANCHES
      const all = await ask(api(TENANT_A.tenantId, GLOBAL), `SELECT count(*) AS n FROM ventas_globales`);
      assert.equal(num(all.body.rows[0].n), await countIn(sA));
    });
  });
});
