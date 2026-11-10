import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Api, TENANT_A, TENANT_B, bootApp, queryRows, seedTenant, withSql, type Fixture } from './support/world';
import { TenantResolutionCache } from '../../src/tenancy/tenant-resolution-cache.service';
import { ReportsService } from '../../src/modules/reports/reports.service';
import { inspectSql } from '../../src/modules/reports/sql-guard';

// Reportes con IA: empleados y ventas por empleado, con DATOS SINTÉTICOS y SQL simulado (generateSql se
// reemplaza por el SQL de cada prueba). Complementan, no sustituyen, la prueba con Groq real en la app.
// Los valores esperados se calculan en JavaScript desde los datos sembrados.

const LA_PAZ = 4; // UTC-4
const utc = (y: number, m: number, d: number, hh: number, mi = 0, ss = 0) =>
  new Date(Date.UTC(y, m - 1, d, hh + LA_PAZ, mi, ss)).toISOString().replace('Z', '');

interface Staff {
  key: string;
  first: string;
  last: string;
  role: string;
  branch: string | null;
  locked?: boolean;
}
interface Sale {
  key: string;
  cashier: string | null; // key del empleado; null = venta web
  branch: string;
  status: 'ENTREGADO' | 'CANCELADO' | 'PROCESANDO';
  at: string; // UTC sin zona
  lines: { qty: number; price: number }[];
}

const STAFF: Staff[] = [
  { key: 'mlopez', first: 'María', last: 'López', role: 'Cajero', branch: 'Centro' },
  { key: 'mperez', first: 'María', last: 'Pérez', role: 'Cajero', branch: 'Norte' },
  { key: 'juan', first: 'Juan', last: 'Rojas', role: 'Vendedor', branch: 'Centro' },
  { key: 'luis', first: 'Luis', last: 'Bloqueado', role: 'Cajero', branch: 'Centro', locked: true },
  { key: 'ana', first: 'Ana', last: 'Dueña', role: 'Dueña', branch: null },
];
const ROLE_PERMISSIONS: Record<string, string[]> = { Cajero: ['USE_POS'], Vendedor: ['USE_POS', 'PROCESS_RETURNS'], Dueña: ['VIEW_REPORTS', 'ALL_BRANCHES', 'USE_POS'] };

const SALES: Sale[] = [
  // 7/11 en La Paz alrededor de la ventana 09:00–14:00
  { key: 'M1', cashier: 'mlopez', branch: 'Centro', status: 'ENTREGADO', at: utc(2026, 11, 7, 8, 59, 59), lines: [{ qty: 2, price: 100 }, { qty: 1, price: 100 }] },
  { key: 'M2', cashier: 'mlopez', branch: 'Centro', status: 'ENTREGADO', at: utc(2026, 11, 7, 9, 0, 0), lines: [{ qty: 1, price: 150 }, { qty: 2, price: 100 }, { qty: 1, price: 100 }] },
  { key: 'M3', cashier: 'mlopez', branch: 'Centro', status: 'ENTREGADO', at: utc(2026, 11, 7, 13, 59, 59), lines: [{ qty: 1, price: 100 }] },
  { key: 'M4', cashier: 'mlopez', branch: 'Centro', status: 'ENTREGADO', at: utc(2026, 11, 7, 14, 0, 0), lines: [{ qty: 1, price: 200 }] },
  { key: 'J1', cashier: 'juan', branch: 'Centro', status: 'ENTREGADO', at: utc(2026, 11, 7, 10, 30), lines: [{ qty: 1, price: 120 }] },
  { key: 'J2', cashier: 'juan', branch: 'Centro', status: 'CANCELADO', at: utc(2026, 11, 7, 11, 0), lines: [{ qty: 3, price: 333 }] },
  { key: 'P1', cashier: 'mperez', branch: 'Norte', status: 'ENTREGADO', at: utc(2026, 11, 7, 12, 0), lines: [{ qty: 1, price: 80 }] },
  { key: 'A1', cashier: 'ana', branch: 'Centro', status: 'ENTREGADO', at: utc(2026, 11, 7, 12, 30), lines: [{ qty: 1, price: 60 }] },
  { key: 'W1', cashier: null, branch: 'Centro', status: 'PROCESANDO', at: utc(2026, 11, 7, 11, 0), lines: [{ qty: 1, price: 500 }] },
  // Más ventas de María López (6/11) para el HAVING "más de cinco ventas"
  { key: 'M5', cashier: 'mlopez', branch: 'Centro', status: 'ENTREGADO', at: utc(2026, 11, 6, 10), lines: [{ qty: 1, price: 50 }] },
  { key: 'M6', cashier: 'mlopez', branch: 'Centro', status: 'ENTREGADO', at: utc(2026, 11, 6, 11), lines: [{ qty: 1, price: 50 }] },
  { key: 'M7', cashier: 'mlopez', branch: 'Centro', status: 'ENTREGADO', at: utc(2026, 11, 6, 12), lines: [{ qty: 1, price: 50 }] },
];
const total = (s: Sale) => s.lines.reduce((a, l) => a + l.qty * l.price, 0);
const units = (s: Sale) => s.lines.reduce((a, l) => a + l.qty, 0);
const isSale = (s: Sale) => s.status !== 'CANCELADO';
const nameOf = (key: string) => STAFF.find((s) => s.key === key)!;
const fullName = (key: string) => `${nameOf(key).first} ${nameOf(key).last}`;
const inWindow = (s: Sale) => s.at >= utc(2026, 11, 7, 9, 0, 0) && s.at < utc(2026, 11, 7, 14, 0, 0);
// Lo devuelto de M2 (1 unidad de su 2.ª línea, a 100)
const RETURNED_M2 = 100;

describe('Reportes con IA: empleados y ventas por empleado (datos sintéticos)', () => {
  let app: INestApplication;
  let base: string;
  let fxA: Fixture;
  let fxB: Fixture;
  let nextSql = '';
  const ids: Record<string, string> = {};
  const created: { table: string; schema: string; id: string }[] = [];
  const sA = `"${TENANT_A.schemaName}"`;
  const sB = `"${TENANT_B.schemaName}"`;
  const GLOBAL_HR = ['VIEW_REPORTS', 'ALL_BRANCHES', 'MANAGE_USERS'];
  const GLOBAL_NO_HR = ['VIEW_REPORTS', 'ALL_BRANCHES'];
  const BRANCH_HR = ['VIEW_REPORTS', 'MANAGE_USERS'];
  const MY_BRANCHES = '({{sucursal:centro}}, {{sucursal:norte}})';

  const token = (tenantId: string, permissions: string[], branchId: string | null) =>
    app.get(JwtService, { strict: false }).sign(
      { sub: randomUUID(), email: 'emp@test.local', role: { id: randomUUID(), name: 'Gerente' }, permissions, branchId, tenantId },
      { secret: process.env.JWT_SECRET, expiresIn: 3600 },
    );
  const api = (tenantId: string, permissions: string[], branchId: string | null = null) => new Api(base, tenantId, token(tenantId, permissions, branchId));
  const ask = async (client: Api, sql: string) => {
    nextSql = sql;
    return client.call('POST', '/reports/dynamic', { body: { prompt: 'pregunta de prueba' } });
  };
  const askOk = async (client: Api, sql: string) => {
    const res = await ask(client, sql);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(['ok', 'sin_datos'].includes(res.body.estado), JSON.stringify(res.body));
    return res.body;
  };
  const setPlan = async (tenantId: string, plan: string) => {
    await queryRows('UPDATE public.tenants SET plan=$2 WHERE id=$1', [tenantId, plan]);
    app.get(TenantResolutionCache, { strict: false }).invalidate(tenantId);
  };

  before(async () => {
    process.env.REPORTS_TIMEZONE = 'America/La_Paz';
    app = await bootApp();
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    const service = app.get(ReportsService, { strict: false }) as unknown as { generateSql: () => Promise<string> };
    service.generateSql = async () => nextSql;
    fxA = await seedTenant(TENANT_A.schemaName);
    fxB = await seedTenant(TENANT_B.schemaName);
    await setPlan(TENANT_A.tenantId, 'pro');
    await setPlan(TENANT_B.tenantId, 'pro');

    await withSql(async (c) => {
      const insert = async (schema: string, table: string, sql: string, params: unknown[]) => {
        await c.query(sql, params);
        created.push({ table, schema, id: params[0] as string });
      };
      for (const name of ['Centro', 'Norte']) {
        ids[`branch:${name}`] = randomUUID();
        await insert(sA, 'branches', `INSERT INTO ${sA}.branches (id,name,"updatedAt") VALUES ($1,$2,now())`, [ids[`branch:${name}`], name]);
      }
      for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
        ids[`role:${role}`] = randomUUID();
        await insert(sA, 'roles', `INSERT INTO ${sA}.roles (id,name,permissions,"updatedAt") VALUES ($1,$2,$3,now())`, [ids[`role:${role}`], `${role}-${ids[`role:${role}`].slice(0, 4)}`, perms]);
      }
      for (const s of STAFF) {
        ids[s.key] = randomUUID();
        await insert(sA, 'users',
          `INSERT INTO ${sA}.users (id,email,password,"firstName","lastName","roleId","branchId","lockedUntil","updatedAt") VALUES ($1,$2,'x',$3,$4,$5,$6,$7,now())`,
          [ids[s.key], `${ids[s.key]}@test.local`, s.first, s.last, ids[`role:${s.role}`], s.branch ? ids[`branch:${s.branch}`] : null, s.locked ? utc(2099, 1, 1, 0) : null]);
      }
      // Clienta: no es personal
      ids.client = randomUUID();
      await insert(sA, 'users', `INSERT INTO ${sA}.users (id,email,password,"firstName","lastName","roleId","updatedAt") VALUES ($1,$2,'x','Carla','Clienta',$3,now())`, [ids.client, `${ids.client}@test.local`, fxA.roleId]);
      const product = randomUUID();
      await insert(sA, 'products', `INSERT INTO ${sA}.products (id,name,sizes,price,stock,sku,"categoryId","updatedAt") VALUES ($1,'Prenda Emp','{M}',100,10,$2,$3,now())`, [product, `EMP-${product.slice(0, 6)}`, fxA.categoryId]);
      for (const sale of SALES) {
        ids[sale.key] = randomUUID();
        await insert(sA, 'orders',
          `INSERT INTO ${sA}.orders (id,"orderNumber",status,"totalAmount","paymentStatus","paymentMethod",source,"userId","cashierId","branchId","createdAt","updatedAt")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())`,
          [ids[sale.key], `EMP-${sale.key}-${ids[sale.key].slice(0, 6)}`, sale.status, total(sale), sale.status === 'CANCELADO' ? 'FALLIDO' : 'COMPLETADO',
            sale.cashier ? 'CASH' : 'STRIPE', sale.cashier ? 'POS' : 'WEB', ids.client, sale.cashier ? ids[sale.cashier] : null, ids[`branch:${sale.branch}`], sale.at]);
        for (const [index, line] of sale.lines.entries()) {
          ids[`${sale.key}:${index}`] = randomUUID();
          await c.query(`INSERT INTO ${sA}.order_items (id,quantity,price,size,"productId","orderId","updatedAt") VALUES ($1,$2,$3,'M',$4,$5,now())`, [ids[`${sale.key}:${index}`], line.qty, line.price, product, ids[sale.key]]);
        }
      }
      // Devolución parcial de M2 (venta de 3 líneas): 1 de las 2 unidades de su 2.ª línea, al precio histórico
      ids.returnM2 = randomUUID();
      await c.query(
        `INSERT INTO ${sA}.returns (id,"returnNumber","totalRefunded","orderId","branchId","userId","cashierId","createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())`,
        [ids.returnM2, `DEV-${ids.returnM2.slice(0, 8)}`, RETURNED_M2, ids.M2, ids['branch:Centro'], ids.client, ids.mlopez, utc(2026, 11, 8, 10)],
      );
      await c.query(
        `INSERT INTO ${sA}.return_items (id,quantity,size,"unitPrice",reason,condition,"returnId","productId","orderItemId") VALUES ($1,1,'M',$2,'WRONG_SIZE','SELLABLE',$3,$4,$5)`,
        [randomUUID(), RETURNED_M2, ids.returnM2, product, ids['M2:1']],
      );
      // Otra tienda con su propio personal
      ids.storeBBranch = randomUUID();
      await insert(sB, 'branches', `INSERT INTO ${sB}.branches (id,name,"updatedAt") VALUES ($1,'Centro',now())`, [ids.storeBBranch]);
      ids.storeBRole = randomUUID();
      await insert(sB, 'roles', `INSERT INTO ${sB}.roles (id,name,permissions,"updatedAt") VALUES ($1,$2,'{USE_POS}',now())`, [ids.storeBRole, `Cajero-${ids.storeBRole.slice(0, 4)}`]);
      ids.beto = randomUUID();
      await insert(sB, 'users', `INSERT INTO ${sB}.users (id,email,password,"firstName","lastName","roleId","branchId","updatedAt") VALUES ($1,$2,'x','Beto','OtraTienda',$3,$4,now())`, [ids.beto, `${ids.beto}@test.local`, ids.storeBRole, ids.storeBBranch]);
      // Una venta POS de Beto en la otra tienda, el MISMO 7/11 dentro de la ventana
      const productB = randomUUID();
      await insert(sB, 'products', `INSERT INTO ${sB}.products (id,name,sizes,price,stock,sku,"categoryId","updatedAt") VALUES ($1,'Prenda B','{M}',70,10,$2,$3,now())`, [productB, `EMPB-${productB.slice(0, 6)}`, fxB.categoryId]);
      ids.saleB = randomUUID();
      await insert(sB, 'orders',
        `INSERT INTO ${sB}.orders (id,"orderNumber",status,"totalAmount","paymentStatus","paymentMethod",source,"userId","cashierId","branchId","createdAt","updatedAt")
         VALUES ($1,$2,'ENTREGADO',70,'COMPLETADO','CASH','POS',$3,$3,$4,$5,now())`,
        [ids.saleB, `EMPB-${ids.saleB.slice(0, 6)}`, ids.beto, ids.storeBBranch, utc(2026, 11, 7, 10)]);
      await c.query(`INSERT INTO ${sB}.order_items (id,quantity,price,size,"productId","orderId","updatedAt") VALUES ($1,1,70,'M',$2,$3,now())`, [randomUUID(), productB, ids.saleB]);
      // Sucursal sin personal ni ventas (para "no hay empleados")
      ids.emptyBranch = randomUUID();
      await insert(sB, 'branches', `INSERT INTO ${sB}.branches (id,name,"updatedAt") VALUES ($1,'Sin Personal',now())`, [ids.emptyBranch]);
    });
  });

  after(async () => {
    await withSql(async (c) => {
      for (const table of ['orders', 'products', 'users', 'roles', 'branches']) {
        for (const row of created.filter((r) => r.table === table)) await c.query(`DELETE FROM ${row.schema}.${table} WHERE id=$1`, [row.id]);
      }
    }).catch((error) => console.error('Limpieza de reports-employees incompleta:', error));
    await setPlan(TENANT_A.tenantId, 'free').catch(() => undefined);
    await setPlan(TENANT_B.tenantId, 'free').catch(() => undefined);
    await app?.close();
  });

  describe('lista de empleados', () => {
    it('incluye personal con y sin sucursal, rol y estado; nunca clientes ni datos sensibles', async () => {
      const body = await askOk(
        api(TENANT_A.tenantId, GLOBAL_HR),
        `SELECT id, nombre_completo, rol, sucursal, asignado_a_sucursal, estado_acceso FROM empleados ORDER BY nombre_completo LIMIT 200`,
      );
      const mine = body.rows.filter((r: any) => STAFF.some((s) => ids[s.key] === r.id));
      assert.deepEqual(
        mine.map((r: any) => [r.nombre_completo, r.sucursal, r.asignado_a_sucursal, r.estado_acceso]).sort(),
        STAFF.map((s) => [`${s.first} ${s.last}`, s.branch, s.branch !== null, s.locked ? 'BLOQUEADO_TEMPORALMENTE' : 'HABILITADO']).sort(),
      );
      assert.ok(!body.rows.some((r: any) => r.id === ids.client), 'una clienta no es personal');
      assert.deepEqual(body.columns, ['id', 'nombre_completo', 'rol', 'sucursal', 'asignado_a_sucursal', 'estado_acceso']);
      // La vista no tiene correo, teléfono, contraseña ni tokens
      const leak = await ask(api(TENANT_A.tenantId, GLOBAL_HR), `SELECT email FROM empleados LIMIT 1`);
      assert.deepEqual([leak.status, leak.body.code], [400, 'REPORT_QUERY_FAILED']);
    });

    it('filtro por sucursal con marcador; el personal sin sucursal no aparece', async () => {
      const body = await askOk(api(TENANT_A.tenantId, GLOBAL_HR), `SELECT nombre_completo FROM empleados WHERE branch_id = {{sucursal:centro}} ORDER BY 1 LIMIT 200`);
      assert.deepEqual(body.rows.map((r: any) => r.nombre_completo), STAFF.filter((s) => s.branch === 'Centro').map((s) => `${s.first} ${s.last}`).sort());
    });

    it('sin el permiso de gestionar empleados: "sin permiso" y no se consulta nada', async () => {
      const res = await ask(api(TENANT_A.tenantId, GLOBAL_NO_HR), `SELECT nombre_completo FROM empleados LIMIT 200`);
      assert.equal(res.status, 200);
      assert.equal(res.body.estado, 'sin_permiso');
      assert.match(res.body.clarification.mensaje, /listado de empleados requiere el permiso/);
      assert.equal(res.body.rowCount, 0);
      // Pero sí puede ver ventas por cajero
      const sales = await askOk(api(TENANT_A.tenantId, GLOBAL_NO_HR), `SELECT count(DISTINCT order_id) AS ventas FROM ventas_globales WHERE es_venta AND cajero_id = {{empleado:juan}}`);
      assert.equal(sales.rows[0].ventas, SALES.filter((s) => s.cashier === 'juan' && isSale(s)).length);
    });

    it('usuario de UNA sucursal: solo el personal asignado a ella', async () => {
      const body = await askOk(api(TENANT_A.tenantId, BRANCH_HR, ids['branch:Centro']), `SELECT nombre_completo, sucursal FROM empleados ORDER BY 1 LIMIT 200`);
      assert.deepEqual(body.rows.map((r: any) => r.nombre_completo), STAFF.filter((s) => s.branch === 'Centro').map((s) => `${s.first} ${s.last}`).sort());
      // Un empleado de otra sucursal no se "encuentra"
      const other = await ask(api(TENANT_A.tenantId, BRANCH_HR, ids['branch:Centro']), `SELECT count(*) AS n FROM ventas_globales WHERE cajero_id = {{empleado:maria perez}}`);
      assert.equal(other.body.estado, 'aclaracion');
      assert.match(other.body.clarification.mensaje, /entre el personal y los cajeros de tu sucursal/);
    });

    it('otra tienda: solo su propio personal', async () => {
      const body = await askOk(api(TENANT_B.tenantId, GLOBAL_HR), `SELECT nombre_completo FROM empleados ORDER BY 1 LIMIT 200`);
      const names = body.rows.map((r: any) => r.nombre_completo);
      assert.ok(names.includes('Beto OtraTienda'));
      assert.ok(!names.some((n: string) => STAFF.some((s) => `${s.first} ${s.last}` === n)), JSON.stringify(names));
    });
  });

  describe('ventas por empleado', () => {
    it('7/11 de 09:00 a 14:00 (14:00 excluido): ventas e importe por cajero; sin cancelados ni web', async () => {
      const body = await askOk(
        api(TENANT_A.tenantId, GLOBAL_HR),
        `SELECT cajero_nombre, count(DISTINCT order_id) AS ventas, sum(total_amount) AS importe
         FROM ventas_globales
         WHERE es_venta AND cajero_id IS NOT NULL AND branch_id IN ${MY_BRANCHES}
           AND created_at >= '2026-11-07 09:00' AND created_at < '2026-11-07 14:00'
         GROUP BY cajero_id, cajero_nombre ORDER BY cajero_nombre`,
      );
      const expected = [...new Set(SALES.filter((s) => s.cashier && isSale(s) && inWindow(s)).map((s) => s.cashier!))]
        .map((key) => {
          const sales = SALES.filter((s) => s.cashier === key && isSale(s) && inWindow(s));
          return { cajero_nombre: fullName(key), ventas: sales.length, importe: sales.reduce((a, s) => a + total(s), 0) };
        })
        .sort((a, b) => a.cajero_nombre.localeCompare(b.cajero_nombre));
      assert.deepEqual(body.rows, expected);
      // Límites: 09:00:00 entra, 13:59:59 entra, 08:59:59 y 14:00:00 no
      const maria = expected.find((e) => e.cajero_nombre === 'María López')!;
      assert.deepEqual([maria.ventas, maria.importe], [2, total(SALES.find((s) => s.key === 'M2')!) + total(SALES.find((s) => s.key === 'M3')!)]);
      assert.deepEqual(body.interpretation.periodo, ['fecha del pedido/venta: desde 2026-11-07 09:00 (incluido) hasta 2026-11-07 14:00 (excluido) — hora America/La_Paz']);
      assert.ok(body.interpretation.avisos.some((a: string) => /ventas web no tienen empleado/.test(a)));
    });

    it('una venta con varios productos cuenta UNA vez; unidades e importe por separado', async () => {
      const body = await askOk(
        api(TENANT_A.tenantId, GLOBAL_HR),
        `SELECT count(DISTINCT rp.order_id) AS ventas, sum(rp.cantidad) AS unidades, count(*) AS lineas
         FROM rendimiento_productos rp WHERE rp.es_venta AND rp.cajero_id = {{empleado:maria lopez}}`,
      );
      const sales = SALES.filter((s) => s.cashier === 'mlopez' && isSale(s));
      assert.deepEqual(body.rows[0], { ventas: sales.length, unidades: sales.reduce((a, s) => a + units(s), 0), lineas: sales.reduce((a, s) => a + s.lines.length, 0) });
      assert.ok(body.rows[0].lineas > body.rows[0].ventas, 'el caso debe tener ventas con varias líneas');
      const amount = await askOk(api(TENANT_A.tenantId, GLOBAL_HR), `SELECT sum(total_amount) AS importe FROM ventas_globales WHERE es_venta AND cajero_id = {{empleado:maría lópez}}`);
      assert.equal(amount.rows[0].importe, sales.reduce((a, s) => a + total(s), 0));
    });

    it('HAVING: empleados con más de cinco ventas', async () => {
      const body = await askOk(
        api(TENANT_A.tenantId, GLOBAL_HR),
        `SELECT e.nombre_completo, e.rol, count(DISTINCT v.order_id) AS ventas
         FROM ventas_globales v JOIN empleados e ON e.id = v.cajero_id
         WHERE v.es_venta AND v.branch_id IN ${MY_BRANCHES}
         GROUP BY e.id, e.nombre_completo, e.rol HAVING count(DISTINCT v.order_id) > 5 ORDER BY ventas DESC`,
      );
      const counts = STAFF.map((s) => ({ name: `${s.first} ${s.last}`, n: SALES.filter((x) => x.cashier === s.key && isSale(x)).length })).filter((x) => x.n > 5);
      assert.deepEqual(body.rows.map((r: any) => [r.nombre_completo, r.ventas]), counts.map((c) => [c.name, c.n]));
      assert.ok(body.interpretation.avisos.some((a: string) => /rol que se muestra es el ACTUAL/.test(a)));
    });

    it('nombre ambiguo («María») pide aclaración; inexistente lo dice', async () => {
      const ambiguous = await ask(api(TENANT_A.tenantId, GLOBAL_HR), `SELECT count(*) AS n FROM ventas_globales WHERE cajero_id = {{empleado:maría}}`);
      assert.equal(ambiguous.body.estado, 'aclaracion');
      const options = ambiguous.body.clarification.opciones[0].opciones;
      assert.ok(options.includes('María López') && options.includes('María Pérez'), JSON.stringify(options));
      const missing = await ask(api(TENANT_A.tenantId, GLOBAL_HR), `SELECT count(*) AS n FROM ventas_globales WHERE cajero_id = {{empleado:pedro}}`);
      assert.equal(missing.body.estado, 'aclaracion');
      assert.match(missing.body.clarification.mensaje, /No encontré al empleado «pedro»/);
    });

    it('si la consulta olvida "cajero_id IS NOT NULL", la fila sin empleado se explica (no es un cajero)', async () => {
      // SQL real que generó Groq para un usuario de Centro el 9/11 (agrupaba las ventas web como cajero NULL)
      const body = await askOk(
        api(TENANT_A.tenantId, BRANCH_HR, ids['branch:Centro']),
        `SELECT cajero_id, cajero_nombre, count(distinct order_id) AS cantidad_ventas FROM ventas_globales
         WHERE es_venta = true AND created_at >= '2026-11-07 09:00' AND created_at < '2026-11-07 14:00' GROUP BY cajero_id, cajero_nombre LIMIT 200`,
      );
      const unattributed = body.rows.find((r: any) => r.cajero_id === null);
      assert.equal(unattributed?.cantidad_ventas, SALES.filter((s) => !s.cashier && isSale(s) && inWindow(s) && s.branch === 'Centro').length);
      assert.ok(body.interpretation.avisos.some((a: string) => /fila sin empleado/.test(a)), JSON.stringify(body.interpretation.avisos));
      // Con el filtro correcto no hay fila sin empleado ni ese aviso
      const ok = await askOk(
        api(TENANT_A.tenantId, BRANCH_HR, ids['branch:Centro']),
        `SELECT cajero_id, cajero_nombre, count(distinct order_id) AS cantidad_ventas FROM ventas_globales
         WHERE es_venta AND cajero_id IS NOT NULL AND created_at >= '2026-11-07 09:00' AND created_at < '2026-11-07 14:00' GROUP BY cajero_id, cajero_nombre`,
      );
      assert.ok(!ok.rows.some((r: any) => r.cajero_id === null));
      assert.ok(!ok.interpretation.avisos.some((a: string) => /fila sin empleado/.test(a)));
    });

    it('las ventas web no se atribuyen a nadie', async () => {
      const body = await askOk(
        api(TENANT_A.tenantId, GLOBAL_HR),
        `SELECT canal, count(DISTINCT order_id) AS ventas, count(cajero_id) AS con_empleado FROM ventas_globales
         WHERE es_venta AND branch_id IN ${MY_BRANCHES} GROUP BY canal ORDER BY canal`,
      );
      const web = body.rows.find((r: any) => r.canal === 'WEB');
      assert.deepEqual(web, { canal: 'WEB', ventas: SALES.filter((s) => !s.cashier && isSale(s)).length, con_empleado: 0 });
    });

    it('"hasta" con fecha sin hora y "<=" se advierte; sin filtro de fecha se dice', async () => {
      const inclusive = await askOk(api(TENANT_A.tenantId, GLOBAL_HR), `SELECT count(*) AS n FROM ventas_globales WHERE created_at <= '2026-11-07'`);
      assert.ok(inclusive.interpretation.avisos.some((a: string) => /solo llega a las 00:00/.test(a)));
      const all = await askOk(api(TENANT_A.tenantId, GLOBAL_HR), `SELECT count(*) AS n FROM ventas_globales WHERE cajero_id IS NOT NULL`);
      assert.deepEqual(all.interpretation.periodo, ['Sin filtro de fecha: se consideró todo el historial.']);
    });
  });

  describe('permisos, sucursales, tiendas y devoluciones', () => {
    const BRANCH_ONLY = ['VIEW_REPORTS'];

    it('usuario de UNA sucursal: ventas por cajero solo de su sucursal (aunque no filtre)', async () => {
      const body = await askOk(
        api(TENANT_A.tenantId, BRANCH_ONLY, ids['branch:Centro']),
        `SELECT cajero_nombre, sucursal, count(DISTINCT order_id) AS ventas, sum(total_amount) AS importe FROM ventas_globales
         WHERE es_venta AND cajero_id IS NOT NULL GROUP BY cajero_id, cajero_nombre, sucursal ORDER BY cajero_nombre`,
      );
      const centro = SALES.filter((s) => s.cashier && isSale(s) && s.branch === 'Centro');
      const expected = [...new Set(centro.map((s) => s.cashier!))]
        .map((key) => {
          const mine = centro.filter((s) => s.cashier === key);
          return { cajero_nombre: fullName(key), sucursal: 'Centro', ventas: mine.length, importe: mine.reduce((a, s) => a + total(s), 0) };
        })
        .sort((a, b) => a.cajero_nombre.localeCompare(b.cajero_nombre));
      assert.deepEqual(body.rows, expected);
      assert.ok(!body.rows.some((r: any) => r.cajero_nombre === 'María Pérez'), 'María Pérez vende en Norte');
    });

    it('usuario de UNA sucursal que nombra otra sucursal: sin permiso, no se consulta nada', async () => {
      const res = await ask(
        api(TENANT_A.tenantId, BRANCH_ONLY, ids['branch:Centro']),
        `SELECT count(DISTINCT order_id) AS ventas FROM ventas_globales WHERE es_venta AND branch_id = {{sucursal:norte}}`,
      );
      assert.equal(res.status, 200);
      assert.deepEqual([res.body.estado, res.body.rowCount, res.body.sql], ['sin_permiso', 0, '']);
    });

    it('usuario de UNA sucursal sin gestionar empleados: el listado es "sin permiso"', async () => {
      const res = await ask(api(TENANT_A.tenantId, BRANCH_ONLY, ids['branch:Centro']), `SELECT nombre_completo FROM empleados LIMIT 200`);
      assert.deepEqual([res.status, res.body.estado, res.body.rowCount], [200, 'sin_permiso', 0]);
    });

    it('sin permiso de reportes: 403 antes de llamar a la IA', async () => {
      const res = await ask(api(TENANT_A.tenantId, ['MANAGE_USERS', 'ALL_BRANCHES']), `SELECT nombre_completo FROM empleados LIMIT 200`);
      assert.equal(res.status, 403);
      assert.ok(!String(res.body.code ?? '').startsWith('REPORT_'), 'lo rechaza el guard de permisos, no el validador');
    });

    it('no hay empleados: "sin_datos" (distinto de "sin permiso" y de "no se puede responder")', async () => {
      const res = await askOk(api(TENANT_B.tenantId, BRANCH_HR, ids.emptyBranch), `SELECT nombre_completo, rol, sucursal FROM empleados ORDER BY 1 LIMIT 200`);
      assert.deepEqual([res.estado, res.rowCount], ['sin_datos', 0]);
      const unanswerable = await ask(api(TENANT_B.tenantId, BRANCH_HR, ids.emptyBranch), `SELECT 'No puedo responder esa pregunta con los datos disponibles' AS mensaje`);
      assert.equal(unanswerable.body.estado, 'no_respondible');
    });

    it('la misma consulta en cada tienda solo cuenta a sus propios cajeros', async () => {
      const sql = `SELECT cajero_id, cajero_nombre, count(DISTINCT order_id) AS ventas FROM ventas_globales
         WHERE es_venta AND cajero_id IS NOT NULL AND created_at >= '2026-11-07 09:00' AND created_at < '2026-11-07 14:00'
         GROUP BY cajero_id, cajero_nombre ORDER BY cajero_nombre`;
      const a = await askOk(api(TENANT_A.tenantId, GLOBAL_NO_HR), sql);
      const b = await askOk(api(TENANT_B.tenantId, GLOBAL_NO_HR), sql);
      assert.ok(!a.rows.some((r: any) => r.cajero_id === ids.beto), 'la tienda A no ve al cajero de B');
      assert.deepEqual(b.rows.filter((r: any) => r.cajero_id === ids.beto).map((r: any) => r.ventas), [1]);
      const staffA = new Set(STAFF.map((s) => ids[s.key]));
      assert.ok(!b.rows.some((r: any) => staffA.has(r.cajero_id)), 'la tienda B no ve a los cajeros de A');
      // Un nombre de la otra tienda no se resuelve
      const other = await ask(api(TENANT_A.tenantId, GLOBAL_HR), `SELECT count(*) AS n FROM ventas_globales WHERE cajero_id = {{empleado:beto}}`);
      assert.equal(other.body.estado, 'aclaracion');
    });

    it('devoluciones: el neto por cajero descuenta lo devuelto y la venta sigue contando UNA vez', async () => {
      const body = await askOk(
        api(TENANT_A.tenantId, GLOBAL_HR),
        `SELECT count(DISTINCT order_id) AS ventas, sum(total_amount) AS bruto, sum(monto_devuelto) AS devuelto, sum(total_neto) AS neto
         FROM ventas_globales WHERE es_venta AND cajero_id = {{empleado:maria lopez}}`,
      );
      const sales = SALES.filter((s) => s.cashier === 'mlopez' && isSale(s));
      const gross = sales.reduce((a, s) => a + total(s), 0);
      assert.deepEqual(body.rows[0], { ventas: sales.length, bruto: gross, devuelto: RETURNED_M2, neto: gross - RETURNED_M2 });
      // Por línea: la devolución queda en la línea devuelta, no se reparte ni se duplica
      const lines = await askOk(
        api(TENANT_A.tenantId, GLOBAL_HR),
        `SELECT order_item_id, cantidad, cantidad_devuelta, subtotal_neto FROM rendimiento_productos WHERE order_id IN (
           SELECT order_id FROM ventas_globales WHERE cajero_id = {{empleado:maria lopez}} AND monto_devuelto > 0) ORDER BY subtotal_neto`,
      );
      const returned = lines.rows.filter((r: any) => r.cantidad_devuelta > 0);
      assert.deepEqual(returned.map((r: any) => r.order_item_id), [ids['M2:1']]);
      assert.equal(lines.rows.length, SALES.find((s) => s.key === 'M2')!.lines.length);
    });
  });

  describe('análisis del período (sin base de datos)', () => {
    it('reconoce límites literales, invertidos, ::date y relativos', async () => {
      const { bounds } = await inspectSql(
        `SELECT 1 FROM ventas_globales v WHERE v.created_at >= '2026-11-07 09:00' AND '2026-11-07 14:00' > v.created_at
         AND v.created_at::date = '2026-11-07' AND v.created_at >= current_date - 1`,
      );
      assert.deepEqual(bounds, [
        { column: 'created_at', op: '>=', value: '2026-11-07 09:00' },
        { column: 'created_at', op: '<', value: '2026-11-07 14:00' },
        { column: 'created_at', op: '=', value: '2026-11-07' },
        { column: 'created_at', op: '>=', value: 'relativo a current_date' },
      ]);
    });
  });
});
