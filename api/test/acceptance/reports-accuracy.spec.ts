import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Api, TENANT_A, TENANT_B, bootApp, queryRows, seedTenant, withSql, type Fixture } from './support/world';
import { TenantResolutionCache } from '../../src/tenancy/tenant-resolution-cache.service';
import { runInTenant } from '../../src/tenancy/tenant-context';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ReportsService } from '../../src/modules/reports/reports.service';
import { buildReportCalendar, reportTimezone } from '../../src/modules/reports/report-calendar';
import { buildSystemPrompt, type PromptContext } from '../../src/modules/reports/report-prompt';
import { extractPlaceholders, resolveEntity } from '../../src/modules/reports/entity-resolver';

// Reportes con IA, etapa 2: fechas en hora local, nombres, ventas brutas/devoluciones/netas.
//
// DOS TIPOS DE PRUEBA:
//   * "SQL simulado": generateSql se reemplaza por el SQL que respondería la IA. Prueban TODO lo demás
//     de verdad (calendario, prompt, resolución de nombres, vistas, roles, zona horaria de la sesión).
//   * "Groq real": llaman al modelo. Solo corren con GROQ_TEST_API_KEY (y GROQ_MODEL opcional); usan
//     únicamente estos datos sintéticos.
// Los valores esperados se calculan en JavaScript a partir de los datos sembrados, sin usar las vistas.

const DAY = 24 * 60 * 60 * 1000;
const LA_PAZ_OFFSET_H = 4; // America/La_Paz = UTC-4 todo el año (sin horario de verano)
// Instante UTC de una hora LOCAL de La Paz
const laPaz = (y: number, m: number, d: number, hh = 12, mi = 0, ss = 0) => new Date(Date.UTC(y, m - 1, d, hh + LA_PAZ_OFFSET_H, mi, ss));
// Como lo guarda Prisma: hora UTC SIN desfase. (Pasar un Date a "pg" lo serializa con el desfase local de
// Node, y PostgreSQL IGNORA el desfase al guardar en un timestamp sin zona: quedaría la hora local.)
const utc = (d: Date) => d.toISOString().replace('Z', '');

interface Line {
  product: string;
  qty: number;
  price: number;
  size: string;
}
interface Ret {
  branch: string;
  product: string;
  qty: number;
  reason: 'WRONG_SIZE' | 'DEFECTIVE' | 'CHANGED_MIND' | 'OTHER';
  condition: 'SELLABLE' | 'DAMAGED';
}
interface Ord {
  key: string;
  branch: string;
  status: 'PENDIENTE' | 'PROCESANDO' | 'ENVIADO' | 'ENTREGADO' | 'CANCELADO';
  at: Date;
  lines: Line[];
  shipping?: number;
  payCurrency?: string;
  method?: string;
  returns?: Ret[];
}

const SALE = new Set(['PROCESANDO', 'ENVIADO', 'ENTREGADO']);
const isSale = (o: Ord) => SALE.has(o.status);
const gross = (o: Ord) => o.lines.reduce((s, l) => s + l.qty * l.price, 0) + (o.shipping ?? 0);
const priceOf = (o: Ord, product: string) => o.lines.find((l) => l.product === product)!.price;
const refunded = (o: Ord) => (o.returns ?? []).reduce((s, r) => s + r.qty * priceOf(o, r.product), 0);
const returnedUnits = (o: Ord, product?: string) => (o.returns ?? []).filter((r) => !product || r.product === product).reduce((s, r) => s + r.qty, 0);
const fullyReturned = (o: Ord) => returnedUnits(o) >= o.lines.reduce((s, l) => s + l.qty, 0);

// "Hoy" en La Paz calculado aparte del código bajo prueba
const localToday = () => {
  const local = new Date(Date.now() - LA_PAZ_OFFSET_H * 3600 * 1000);
  return { y: local.getUTCFullYear(), m: local.getUTCMonth() + 1, d: local.getUTCDate() };
};
const shiftDays = (base: { y: number; m: number; d: number }, days: number) => {
  const t = new Date(Date.UTC(base.y, base.m - 1, base.d + days));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};
const today = localToday();
const yesterday = shiftDays(today, -1);
const twoDaysAgo = shiftDays(today, -2);

const ORDERS: Ord[] = [
  // Centro: un pedido de 3 productos con dos devoluciones parciales (una recibida en otra sucursal)
  {
    key: 'O1', branch: 'Centro', status: 'ENTREGADO', at: laPaz(2026, 11, 5, 11), payCurrency: 'BOB', method: 'CASH',
    lines: [
      { product: 'Set Deportivo', qty: 2, price: 180, size: 'M' },
      { product: 'Blusa Lino', qty: 1, price: 100, size: 'S' },
      { product: 'Jean Mom', qty: 3, price: 200, size: '38' },
    ],
    returns: [
      { branch: 'Centro', product: 'Set Deportivo', qty: 1, reason: 'WRONG_SIZE', condition: 'SELLABLE' },
      { branch: 'Centro Norte', product: 'Jean Mom', qty: 2, reason: 'DEFECTIVE', condition: 'DAMAGED' },
    ],
  },
  // Centro: envío de 20 y devolución total (queda REEMBOLSADO; el envío no se devuelve)
  {
    key: 'O2', branch: 'Centro', status: 'ENTREGADO', at: laPaz(2026, 11, 6, 18), shipping: 20, payCurrency: 'BOB', method: 'STRIPE',
    lines: [{ product: 'Blusa Lino', qty: 2, price: 100, size: 'M' }],
    returns: [{ branch: 'Centro', product: 'Blusa Lino', qty: 2, reason: 'CHANGED_MIND', condition: 'SELLABLE' }],
  },
  { key: 'O3', branch: 'Centro', status: 'PENDIENTE', at: laPaz(2026, 11, 7, 10), lines: [{ product: 'Set Deportivo Niña', qty: 1, price: 150, size: 'S' }] },
  { key: 'O4', branch: 'Centro', status: 'CANCELADO', at: laPaz(2026, 11, 7, 11), lines: [{ product: 'Jean Mom', qty: 5, price: 200, size: '40' }] },
  // Cobrado en USDT: el importe sigue en la moneda del catálogo
  { key: 'O5', branch: 'Centro', status: 'PROCESANDO', at: laPaz(2026, 11, 8, 9), payCurrency: 'USDT', method: 'USDT', lines: [{ product: 'Set Deportivo', qty: 1, price: 180, size: 'L' }] },
  // Límites de mes y de año (hora local)
  { key: 'O8', branch: 'Centro', status: 'ENTREGADO', at: laPaz(2026, 10, 31, 23, 30), lines: [{ product: 'Set Deportivo', qty: 1, price: 180, size: 'M' }] },
  { key: 'O9', branch: 'Centro', status: 'ENTREGADO', at: laPaz(2026, 11, 1, 0, 10), lines: [{ product: 'Set Deportivo', qty: 1, price: 180, size: 'M' }] },
  { key: 'O10', branch: 'Centro', status: 'ENTREGADO', at: laPaz(2025, 12, 31, 23, 50), lines: [{ product: 'Jean Mom', qty: 1, price: 200, size: '38' }] },
  { key: 'O11', branch: 'Centro', status: 'ENTREGADO', at: laPaz(2026, 1, 1, 0, 10), lines: [{ product: 'Jean Mom', qty: 1, price: 200, size: '38' }] },
  // Centro Norte y Sucursal Sur
  { key: 'O6', branch: 'Centro Norte', status: 'ENTREGADO', at: laPaz(2026, 11, 5, 15), lines: [{ product: 'Set Deportivo Niña', qty: 2, price: 150, size: 'S' }] },
  { key: 'O7', branch: 'Sucursal Sur', status: 'ENVIADO', at: laPaz(2026, 11, 4, 12), lines: [{ product: 'Blusa Seda', qty: 1, price: 250, size: 'M' }] },
  // Alrededor de la medianoche local de ayer y de hoy (relativos al momento de la prueba)
  { key: 'Y1', branch: 'Sucursal Sur', status: 'ENTREGADO', at: laPaz(yesterday.y, yesterday.m, yesterday.d, 0, 0, 30), lines: [{ product: 'Blusa Seda', qty: 1, price: 250, size: 'S' }] },
  { key: 'Y2', branch: 'Sucursal Sur', status: 'ENTREGADO', at: laPaz(yesterday.y, yesterday.m, yesterday.d, 23, 59, 30), lines: [{ product: 'Blusa Seda', qty: 1, price: 250, size: 'S' }] },
  { key: 'T1', branch: 'Sucursal Sur', status: 'ENTREGADO', at: laPaz(today.y, today.m, today.d, 0, 0, 30), lines: [{ product: 'Blusa Seda', qty: 1, price: 250, size: 'S' }] },
  { key: 'D1', branch: 'Sucursal Sur', status: 'ENTREGADO', at: laPaz(twoDaysAgo.y, twoDaysAgo.m, twoDaysAgo.d, 23, 59, 30), lines: [{ product: 'Blusa Seda', qty: 1, price: 250, size: 'S' }] },
];
const BRANCHES = ['Centro', 'Centro Norte', 'Sucursal Sur'];
const PRODUCTS: Record<string, { price: number; category: string }> = {
  'Set Deportivo': { price: 180, category: 'Deportivo' },
  'Set Deportivo Niña': { price: 150, category: 'Deportivo' },
  'Blusa Lino': { price: 100, category: 'Blusas' },
  'Blusa Seda': { price: 250, category: 'Blusas' },
  'Jean Mom': { price: 200, category: 'Jeans' },
};
const MY_BRANCHES_SQL = `({{sucursal:centro}}, {{sucursal:centro norte}}, {{sucursal:sur}})`;

describe('Reportes con IA, etapa 2: exactitud', () => {
  let app: INestApplication;
  let base: string;
  let fxA: Fixture;
  let fxB: Fixture;
  let service: { generateSql: (prompt: string, context: PromptContext) => Promise<string> };
  let realGenerateSql: (prompt: string, context: PromptContext) => Promise<string>;
  let nextSql = '';
  let lastContext: PromptContext | null = null;
  const branchIds: Record<string, string> = {};
  const productIds: Record<string, string> = {};
  const orderIds: Record<string, string> = {};
  const created: { table: string; schema: string; id: string }[] = [];
  const envBefore = { tz: process.env.REPORTS_TIMEZONE, currency: process.env.PAYMENT_CURRENCY };

  const sA = `"${TENANT_A.schemaName}"`;
  const sB = `"${TENANT_B.schemaName}"`;
  const GLOBAL = ['VIEW_REPORTS', 'ALL_BRANCHES'];
  const BRANCH = ['VIEW_REPORTS'];

  const token = (tenantId: string, permissions: string[], branchId: string | null) =>
    app.get(JwtService, { strict: false }).sign(
      { sub: randomUUID(), email: 'acc@test.local', role: { id: randomUUID(), name: 'Gerente' }, permissions, branchId, tenantId },
      { secret: process.env.JWT_SECRET, expiresIn: 3600 },
    );
  const api = (tenantId: string, permissions: string[], branchId: string | null = null) => new Api(base, tenantId, token(tenantId, permissions, branchId));
  const ask = async (client: Api, sql: string, prompt = 'pregunta de prueba') => {
    nextSql = sql;
    return client.call('POST', '/reports/dynamic', { body: { prompt } });
  };
  const askOk = async (client: Api, sql: string) => {
    const res = await ask(client, sql);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.clarification, undefined, JSON.stringify(res.body.clarification));
    return res.body;
  };
  const setPlan = async (tenantId: string, plan: string) => {
    await queryRows('UPDATE public.tenants SET plan=$2 WHERE id=$1', [tenantId, plan]);
    app.get(TenantResolutionCache, { strict: false }).invalidate(tenantId);
  };

  before(async () => {
    // Como la demo de Bolivia
    process.env.REPORTS_TIMEZONE = 'America/La_Paz';
    process.env.PAYMENT_CURRENCY = 'bob';

    app = await bootApp();
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    service = app.get(ReportsService, { strict: false }) as unknown as typeof service;
    realGenerateSql = service.generateSql.bind(service);
    service.generateSql = async (_prompt, context) => {
      lastContext = context;
      return nextSql;
    };
    fxA = await seedTenant(TENANT_A.schemaName);
    fxB = await seedTenant(TENANT_B.schemaName);
    await setPlan(TENANT_A.tenantId, 'pro');
    await setPlan(TENANT_B.tenantId, 'pro');

    await withSql(async (c) => {
      const insert = async (schema: string, table: string, sql: string, params: unknown[]) => {
        await c.query(sql, params);
        created.push({ table, schema, id: params[0] as string });
      };
      for (const name of BRANCHES) {
        branchIds[name] = randomUUID();
        await insert(sA, 'branches', `INSERT INTO ${sA}.branches (id,name,"updatedAt") VALUES ($1,$2,now())`, [branchIds[name], name]);
      }
      const categories: Record<string, string> = {};
      for (const cat of new Set(Object.values(PRODUCTS).map((p) => p.category))) {
        categories[cat] = randomUUID();
        await insert(sA, 'categories', `INSERT INTO ${sA}.categories (id,name,slug,"updatedAt") VALUES ($1,$2,$3,now())`, [categories[cat], cat, `acc-${categories[cat]}`]);
      }
      for (const [name, p] of Object.entries(PRODUCTS)) {
        productIds[name] = randomUUID();
        await insert(sA, 'products', `INSERT INTO ${sA}.products (id,name,sizes,price,stock,sku,"categoryId","updatedAt") VALUES ($1,$2,'{S,M}',$3,10,$4,$5,now())`, [
          productIds[name], name, p.price, `ACC-${name.toUpperCase().replace(/\W+/g, '-')}-${productIds[name].slice(0, 4)}`, categories[p.category],
        ]);
      }
      const customer = randomUUID();
      const cashier = randomUUID();
      for (const [id, first] of [[customer, 'Cliente'], [cashier, 'Cajera']]) {
        await insert(sA, 'users', `INSERT INTO ${sA}.users (id,email,password,"firstName","lastName","roleId","updatedAt") VALUES ($1,$2,'x',$3,'Acc',$4,now())`, [id, `${id}@test.local`, first, fxA.roleId]);
      }

      for (const o of ORDERS) {
        const id = (orderIds[o.key] = randomUUID());
        const paymentStatus = !isSale(o) ? (o.status === 'CANCELADO' ? 'FALLIDO' : 'PENDIENTE') : fullyReturned(o) ? 'REEMBOLSADO' : 'COMPLETADO';
        await insert(sA, 'orders',
          `INSERT INTO ${sA}.orders (id,"orderNumber",status,"totalAmount","shippingCost","paymentStatus","paymentMethod",source,"fulfillmentType","userId","branchId","createdAt","updatedAt")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())`,
          [id, `ACC-${o.key}-${id.slice(0, 6)}`, o.status, gross(o), o.shipping ?? 0, paymentStatus, o.method === 'USDT' ? 'USDT' : o.method ?? 'STRIPE',
            o.method === 'CASH' ? 'POS' : 'WEB', o.shipping ? 'DELIVERY' : 'PICKUP', customer, branchIds[o.branch], utc(o.at)]);
        const itemIds: Record<string, string> = {};
        for (const l of o.lines) {
          itemIds[l.product] = randomUUID();
          await c.query(`INSERT INTO ${sA}.order_items (id,quantity,price,size,"productId","orderId","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now())`, [
            itemIds[l.product], l.qty, l.price, l.size, productIds[l.product], id,
          ]);
        }
        if (o.payCurrency) {
          await c.query(`INSERT INTO ${sA}.payments (id,amount,currency,status,"paymentMethod","transactionId","userId","orderId","updatedAt") VALUES ($1,$2,$3,'COMPLETADO',$4,$5,$6,$7,now())`, [
            randomUUID(), gross(o), o.payCurrency, o.method, `tx-${o.key}`, customer, id,
          ]);
        }
        for (const [i, r] of (o.returns ?? []).entries()) {
          const returnId = randomUUID();
          const price = priceOf(o, r.product);
          await c.query(
            `INSERT INTO ${sA}.returns (id,"returnNumber","totalRefunded","orderId","branchId","userId","cashierId","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())`,
            [returnId, `RET-${o.key}-${i}-${returnId.slice(0, 4)}`, r.qty * price, id, branchIds[r.branch], customer, cashier, utc(new Date(o.at.getTime() + (i + 1) * DAY))],
          );
          await c.query(
            `INSERT INTO ${sA}.return_items (id,quantity,size,"unitPrice",reason,condition,"returnId","productId","orderItemId") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [randomUUID(), r.qty, o.lines.find((l) => l.product === r.product)!.size, price, r.reason, r.condition, returnId, productIds[r.product], itemIds[r.product]],
          );
        }
      }

      // Otra tienda con una sucursal que se llama igual
      const bBranch = randomUUID();
      await insert(sB, 'branches', `INSERT INTO ${sB}.branches (id,name,"updatedAt") VALUES ($1,'Centro',now())`, [bBranch]);
      branchIds.storeB = bBranch;
      const bUser = randomUUID();
      await insert(sB, 'users', `INSERT INTO ${sB}.users (id,email,password,"roleId","updatedAt") VALUES ($1,$2,'x',$3,now())`, [bUser, `${bUser}@test.local`, fxB.roleId]);
      const bOrder = randomUUID();
      await insert(sB, 'orders', `INSERT INTO ${sB}.orders (id,"orderNumber",status,"totalAmount","userId","branchId","createdAt","updatedAt") VALUES ($1,$2,'ENTREGADO',9999,$3,$4,$5,now())`, [
        bOrder, `B-${bOrder.slice(0, 6)}`, bUser, bBranch, utc(laPaz(2026, 11, 5)),
      ]);
    });
  });

  after(async () => {
    await withSql(async (c) => {
      // orders primero: arrastra (ON DELETE CASCADE) líneas, pagos y devoluciones
      const order = ['orders', 'products', 'categories', 'users', 'branches'];
      for (const table of order) {
        for (const row of created.filter((r) => r.table === table)) await c.query(`DELETE FROM ${row.schema}.${table} WHERE id=$1`, [row.id]);
      }
    }).catch((error) => console.error('Limpieza de reports-accuracy incompleta:', error));
    process.env.REPORTS_TIMEZONE = envBefore.tz;
    process.env.PAYMENT_CURRENCY = envBefore.currency;
    if (envBefore.tz === undefined) delete process.env.REPORTS_TIMEZONE;
    await setPlan(TENANT_A.tenantId, 'free').catch(() => undefined);
    await setPlan(TENANT_B.tenantId, 'free').catch(() => undefined);
    await app?.close();
  });

  // ===========================================================================================
  describe('calendario de la tienda (sin base de datos)', () => {
    it('zona por defecto America/La_Paz; una zona inválida vuelve al valor por defecto', () => {
      const saved = process.env.REPORTS_TIMEZONE;
      delete process.env.REPORTS_TIMEZONE;
      assert.equal(reportTimezone(), 'America/La_Paz');
      process.env.REPORTS_TIMEZONE = 'Marte/Olympus';
      assert.equal(reportTimezone(), 'America/La_Paz');
      process.env.REPORTS_TIMEZONE = 'UTC';
      assert.equal(reportTimezone(), 'UTC');
      process.env.REPORTS_TIMEZONE = saved;
    });

    it('23:30 del 31 de octubre en La Paz (03:30 UTC del 1 de noviembre) sigue siendo octubre', () => {
      const cal = buildReportCalendar(new Date('2026-11-01T03:30:00Z'), 'America/La_Paz');
      assert.equal(cal.ahora, '2026-10-31 23:30');
      assert.deepEqual(cal.hoy, { desde: '2026-10-31', hasta: '2026-11-01' });
      assert.deepEqual(cal.ayer, { desde: '2026-10-30', hasta: '2026-10-31' });
      assert.deepEqual(cal.esteMes, { desde: '2026-10-01', hasta: '2026-11-01' });
      assert.deepEqual(cal.mesPasado, { desde: '2026-09-01', hasta: '2026-10-01' });
      // El mismo instante en UTC ya es noviembre: por eso antes "mes pasado" fallaba
      assert.deepEqual(buildReportCalendar(new Date('2026-11-01T03:30:00Z'), 'UTC').esteMes, { desde: '2026-11-01', hasta: '2026-12-01' });
    });

    it('fin de año: 23:59 del 31 de diciembre local', () => {
      const cal = buildReportCalendar(new Date('2026-01-01T03:59:00Z'), 'America/La_Paz');
      assert.deepEqual(cal.hoy, { desde: '2025-12-31', hasta: '2026-01-01' });
      assert.deepEqual(cal.esteMes, { desde: '2025-12-01', hasta: '2026-01-01' });
      assert.deepEqual(cal.mesPasado, { desde: '2025-11-01', hasta: '2025-12-01' });
      assert.deepEqual(cal.esteAnio, { desde: '2025-01-01', hasta: '2026-01-01' });
      assert.deepEqual(cal.anioPasado, { desde: '2024-01-01', hasta: '2025-01-01' });
    });

    it('medianoche exacta, febrero y semanas de lunes a domingo', () => {
      const cal = buildReportCalendar(new Date('2026-03-01T04:00:00Z'), 'America/La_Paz'); // 00:00 local del 1/3
      assert.equal(cal.ahora, '2026-03-01 00:00');
      assert.deepEqual(cal.ayer, { desde: '2026-02-28', hasta: '2026-03-01' });
      assert.deepEqual(cal.mesPasado, { desde: '2026-02-01', hasta: '2026-03-01' });
      const week = buildReportCalendar(new Date('2026-11-12T15:00:00Z'), 'America/La_Paz'); // jueves
      assert.deepEqual(week.estaSemana, { desde: '2026-11-09', hasta: '2026-11-16' });
      assert.deepEqual(week.semanaPasada, { desde: '2026-11-02', hasta: '2026-11-09' });
      const sunday = buildReportCalendar(new Date('2026-11-16T03:00:00Z'), 'America/La_Paz'); // domingo 15, 23:00
      assert.deepEqual(sunday.estaSemana, { desde: '2026-11-09', hasta: '2026-11-16' });
    });

    it('el prompt lleva la zona, la hora local, los rangos y la moneda', () => {
      const cal = buildReportCalendar(new Date('2026-11-01T03:30:00Z'), 'America/La_Paz');
      const prompt = buildSystemPrompt({ branchId: null, calendar: cal, currency: 'BOB' });
      assert.match(prompt, /America\/La_Paz\. Ahora son las 2026-10-31 23:30/);
      assert.match(prompt, /ayer: desde '2026-10-30' \(incluido\) hasta '2026-10-31' \(excluido\)/);
      assert.match(prompt, /mes pasado: desde '2026-09-01'/);
      assert.match(prompt, /están en BOB/);
      assert.match(prompt, /\{\{producto:set deportivo\}\}/);
    });
  });

  describe('resolución de nombres (sin base de datos)', () => {
    const branches = [
      { id: 'c', name: 'Centro' },
      { id: 'cn', name: 'Centro Norte' },
      { id: 's', name: 'Sucursal Sur' },
    ];
    const products = [
      { id: 'sd', name: 'Set Deportivo', code: 'SD-1' },
      { id: 'sdn', name: 'Set Deportivo Niña', code: 'SD-2' },
      { id: 'bl', name: 'Blusa Lino', code: 'BL-1' },
      { id: 'bs', name: 'Blusa Seda', code: 'BS-1' },
      { id: 'jm', name: 'Jean Mom', code: 'JM-1' },
    ];
    const ok = (r: ReturnType<typeof resolveEntity>) => (r.status === 'ok' ? [r.id, r.method] : r.status);

    it('sin mayúsculas, tildes ni palabras genéricas; exacto antes que parcial', () => {
      assert.deepEqual(ok(resolveEntity('sucursal', 'CENTRO', branches)), ['c', 'exacto']);
      assert.deepEqual(ok(resolveEntity('sucursal', 'sucursal centro', branches)), ['c', 'exacto']);
      assert.deepEqual(ok(resolveEntity('sucursal', 'la sucursal Sur', branches)), ['s', 'exacto']);
      assert.deepEqual(ok(resolveEntity('sucursal', 'norte', branches)), ['cn', 'parcial']);
      assert.deepEqual(ok(resolveEntity('producto', 'set deportivo', products)), ['sd', 'exacto']);
      assert.deepEqual(ok(resolveEntity('producto', 'Set deportivo nina', products)), ['sdn', 'exacto']);
      assert.deepEqual(ok(resolveEntity('producto', 'sets deportivos', products)), ['sd', 'exacto']);
      assert.deepEqual(ok(resolveEntity('producto', 'jm-1', products)), ['jm', 'exacto']);
    });

    it('errores de dictado: aproximado solo si hay un candidato claro', () => {
      assert.deepEqual(ok(resolveEntity('producto', 'yin mom', products)), ['jm', 'aproximado']);
      assert.deepEqual(ok(resolveEntity('producto', 'set deportibo', products)), ['sd', 'aproximado']);
    });

    it('varias coincidencias o ninguna: nunca elige', () => {
      const blusa = resolveEntity('producto', 'blusa', products);
      assert.equal(blusa.status, 'ambiguous');
      assert.deepEqual(blusa.status === 'ambiguous' && blusa.options.map((o) => o.name), ['Blusa Lino', 'Blusa Seda']);
      assert.equal(resolveEntity('producto', 'zapatos', products).status, 'not_found');
      assert.equal(resolveEntity('sucursal', 'sucursal', branches).status, 'ambiguous');
      // Dos productos que se llaman igual: hay que preguntar (se distinguen por SKU)
      assert.equal(resolveEntity('producto', 'jean mom', [...products, { id: 'jm2', name: 'Jean Mom', code: 'JM-2' }]).status, 'ambiguous');
    });

    it('marcadores: se extraen, y uno mal formado se rechaza', () => {
      assert.deepEqual(
        extractPlaceholders('SELECT 1 FROM orders WHERE branch_id = {{sucursal: Centro }} AND x IN ({{producto:set}}, {{Producto:jean}})').map((p) => [p.kind, p.text]),
        [['sucursal', 'Centro'], ['producto', 'set'], ['producto', 'jean']],
      );
      assert.throws(() => extractPlaceholders('SELECT 1 FROM orders WHERE branch_id = {{sucursal:centro'), /marcador/);
      assert.throws(() => extractPlaceholders('SELECT 1 FROM orders WHERE branch_id = {{cliente:ana}}'), /marcador/);
    });
  });

  // ===========================================================================================
  describe('SQL simulado: fechas en hora local', () => {
    const keyOf = (orderNumber: string) => orderNumber.split('-')[1];

    it('"ayer" con current_date: exactamente las ventas de 00:00:30 y 23:59:30 locales de ayer', async () => {
      const body = await askOk(
        api(TENANT_A.tenantId, GLOBAL),
        `SELECT order_number FROM ventas_globales
         WHERE es_venta AND branch_id = {{sucursal:sur}} AND created_at >= current_date - 1 AND created_at < current_date
         ORDER BY created_at LIMIT 50`,
      );
      // Independiente: los pedidos sembrados con la fecha local de ayer (UTC-4 fijo)
      assert.deepEqual(body.rows.map((r: any) => keyOf(r.order_number)), ['Y1', 'Y2']);
      const totals = await askOk(
        api(TENANT_A.tenantId, GLOBAL),
        `SELECT count(*) AS pedidos, coalesce(sum(total_amount), 0) AS ventas FROM ventas_globales
         WHERE es_venta AND branch_id = {{sucursal:sur}} AND created_at >= current_date - 1 AND created_at < current_date`,
      );
      const expected = ORDERS.filter((o) => ['Y1', 'Y2'].includes(o.key));
      assert.deepEqual([totals.rows[0].pedidos, totals.rows[0].ventas], [2, expected.reduce((s, o) => s + gross(o), 0)]);
      assert.equal(body.interpretation.zonaHoraria, 'America/La_Paz');
      assert.equal(lastContext?.calendar.timezone, 'America/La_Paz');
    });

    it('con los rangos del prompt ("ayer" literal) da lo mismo', async () => {
      const cal = buildReportCalendar(new Date(), 'America/La_Paz');
      const body = await askOk(
        api(TENANT_A.tenantId, GLOBAL),
        `SELECT order_number FROM ventas_globales WHERE es_venta AND branch_id = {{sucursal:sur}}
         AND created_at >= '${cal.ayer.desde}' AND created_at < '${cal.ayer.hasta}' ORDER BY created_at LIMIT 50`,
      );
      assert.deepEqual(body.rows.map((r: any) => keyOf(r.order_number)), ['Y1', 'Y2']);
    });

    it('con REPORTS_TIMEZONE=UTC el mismo SQL corta el día en UTC (la zona sí se aplica)', async () => {
      process.env.REPORTS_TIMEZONE = 'UTC';
      try {
        const body = await askOk(
          api(TENANT_A.tenantId, GLOBAL),
          `SELECT order_number FROM ventas_globales WHERE es_venta AND branch_id = {{sucursal:sur}}
           AND created_at >= current_date - 1 AND created_at < current_date ORDER BY created_at LIMIT 50`,
        );
        const utcYesterday = new Date(Date.now() - DAY).toISOString().slice(0, 10);
        const expected = ORDERS.filter((o) => o.branch === 'Sucursal Sur' && isSale(o) && o.at.toISOString().slice(0, 10) === utcYesterday)
          .sort((a, b) => a.at.getTime() - b.at.getTime())
          .map((o) => o.key);
        assert.deepEqual(body.rows.map((r: any) => keyOf(r.order_number)), expected);
        // En UTC "ayer" no es lo mismo: Y1 (00:00:30 local = 04:00:30 UTC) sigue, Y2 (23:59:30 local) ya es "hoy" en UTC
        assert.notDeepEqual(expected, ['Y1', 'Y2']);
        assert.equal(body.interpretation.zonaHoraria, 'UTC');
      } finally {
        process.env.REPORTS_TIMEZONE = 'America/La_Paz';
      }
    });

    it('fin de mes: la venta de las 23:30 del 31/10 local es de octubre; la de las 00:10 del 1/11, de noviembre', async () => {
      const body = await askOk(
        api(TENANT_A.tenantId, GLOBAL),
        `SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS mes, count(*) AS pedidos
         FROM orders WHERE es_venta AND branch_id = {{sucursal:centro}} AND id IN ('${orderIds.O8}', '${orderIds.O9}')
         GROUP BY 1 ORDER BY 1`,
      );
      assert.deepEqual(body.rows, [{ mes: '2026-10', pedidos: 1 }, { mes: '2026-11', pedidos: 1 }]);
      const october = await askOk(
        api(TENANT_A.tenantId, GLOBAL),
        `SELECT count(*) AS pedidos FROM orders WHERE es_venta AND branch_id = {{sucursal:centro}}
         AND created_at >= '2026-10-01' AND created_at < '2026-11-01'`,
      );
      assert.equal(october.rows[0].pedidos, ORDERS.filter((o) => o.branch === 'Centro' && isSale(o) && o.at >= laPaz(2026, 10, 1, 0) && o.at < laPaz(2026, 11, 1, 0)).length);
    });

    it('fin de año: 23:50 del 31/12 local es 2025; 00:10 del 1/1 es 2026; la fecha sale con su zona', async () => {
      const body = await askOk(
        api(TENANT_A.tenantId, GLOBAL),
        `SELECT extract(year FROM created_at)::int AS anio, created_at FROM orders WHERE id IN ('${orderIds.O10}', '${orderIds.O11}') ORDER BY created_at`,
      );
      assert.deepEqual(body.rows.map((r: any) => r.anio), [2025, 2026]);
      assert.match(body.rows[0].created_at, /^2025-12-31T23:50:00(\.0+)?-04:00$/);
    });
  });

  describe('SQL simulado: ventas brutas, devoluciones y netas', () => {
    const byBranch = (branch: string) => {
      const sales = ORDERS.filter((o) => o.branch === branch && isSale(o));
      return {
        sucursal: branch,
        pedidos: sales.length,
        brutas: sales.reduce((s, o) => s + gross(o), 0),
        devoluciones: sales.reduce((s, o) => s + refunded(o), 0),
        netas: sales.reduce((s, o) => s + gross(o) - refunded(o), 0),
      };
    };

    it('por sucursal: una fila por pedido aunque tenga varios productos, pago y devoluciones parciales', async () => {
      const body = await askOk(
        api(TENANT_A.tenantId, GLOBAL),
        `SELECT sucursal, count(*) AS pedidos, sum(total_amount) AS brutas, sum(monto_devuelto) AS devoluciones, sum(total_neto) AS netas
         FROM ventas_globales WHERE es_venta AND branch_id IN ${MY_BRANCHES_SQL} GROUP BY sucursal ORDER BY sucursal`,
      );
      assert.deepEqual(body.rows, BRANCHES.map(byBranch));
      // Centro: O1 (1060, devuelto 580 entre dos sucursales) + O2 (220, devuelto 200; envío no) + O5, O8-O11
      assert.equal(byBranch('Centro').devoluciones, 780);
      const dup = await askOk(
        api(TENANT_A.tenantId, GLOBAL),
        `SELECT count(*) AS filas, count(DISTINCT order_id) AS pedidos FROM ventas_globales WHERE branch_id = {{sucursal:centro}}`,
      );
      assert.equal(dup.rows[0].filas, dup.rows[0].pedidos);
    });

    it('pendientes y cancelados no son ventas; el pedido devuelto completo sigue siendo venta bruta', async () => {
      const body = await askOk(
        api(TENANT_A.tenantId, GLOBAL),
        `SELECT status, estado_pago, count(*) AS pedidos, sum(total_amount) AS total, bool_and(es_venta) AS es_venta
         FROM orders WHERE branch_id = {{sucursal:centro}} GROUP BY status, estado_pago ORDER BY status, estado_pago`,
      );
      const rows = body.rows as { status: string; estado_pago: string; pedidos: number; es_venta: boolean }[];
      assert.deepEqual(rows.find((r) => r.status === 'PENDIENTE')?.es_venta, false);
      assert.deepEqual(rows.find((r) => r.status === 'CANCELADO')?.es_venta, false);
      assert.deepEqual(rows.find((r) => r.estado_pago === 'REEMBOLSADO'), { status: 'ENTREGADO', estado_pago: 'REEMBOLSADO', pedidos: 1, total: 220, es_venta: true });
    });

    it('productos (5 vistas con JOIN, GROUP BY y HAVING): vendidas, devueltas y netas sin duplicar', async () => {
      const body = await askOk(
        api(TENANT_A.tenantId, GLOBAL),
        `SELECT p.name AS producto, c.name AS categoria, sum(rp.cantidad) AS vendidas, sum(rp.cantidad_devuelta) AS devueltas,
                sum(rp.cantidad_neta) AS netas, sum(rp.subtotal_neto) AS importe_neto
         FROM rendimiento_productos rp
         JOIN products p ON p.id = rp.product_id
         JOIN categories c ON c.id = p.category_id
         JOIN branches b ON b.id = rp.branch_id
         JOIN ventas_globales vg ON vg.order_id = rp.order_id
         WHERE rp.es_venta AND b.id IN ${MY_BRANCHES_SQL}
         GROUP BY p.name, c.name
         HAVING sum(rp.cantidad) >= 2
         ORDER BY netas DESC, producto`,
      );
      const expected = Object.entries(PRODUCTS)
        .map(([name, p]) => {
          const lines = ORDERS.filter(isSale).flatMap((o) => o.lines.filter((l) => l.product === name).map((l) => ({ o, l })));
          const vendidas = lines.reduce((s, x) => s + x.l.qty, 0);
          const devueltas = lines.reduce((s, x) => s + returnedUnits(x.o, name), 0);
          return { producto: name, categoria: p.category, vendidas, devueltas, netas: vendidas - devueltas, importe_neto: lines.reduce((s, x) => s + (x.l.qty - returnedUnits(x.o, name)) * x.l.price, 0) };
        })
        .filter((r) => r.vendidas >= 2)
        .sort((a, b) => b.netas - a.netas || a.producto.localeCompare(b.producto));
      assert.deepEqual(body.rows, expected);
    });

    it('vista devoluciones: por la sucursal que la RECIBIÓ, motivo y condición', async () => {
      const body = await askOk(
        api(TENANT_A.tenantId, GLOBAL),
        `SELECT sucursal, motivo, condicion, sum(cantidad) AS unidades, sum(monto) AS monto
         FROM devoluciones WHERE branch_id IN ${MY_BRANCHES_SQL} GROUP BY sucursal, motivo, condicion ORDER BY sucursal, motivo`,
      );
      const expected = ORDERS.flatMap((o) => (o.returns ?? []).map((r) => ({ sucursal: r.branch, motivo: r.reason, condicion: r.condition, unidades: r.qty, monto: r.qty * priceOf(o, r.product) })))
        .sort((a, b) => a.sucursal.localeCompare(b.sucursal) || a.motivo.localeCompare(b.motivo));
      assert.deepEqual(body.rows, expected);
    });

    it('usuario de UNA sucursal: sus ventas netas incluyen lo devuelto en otra sucursal; la vista devoluciones, solo lo recibido en la suya', async () => {
      const centro = api(TENANT_A.tenantId, BRANCH, branchIds.Centro);
      const sales = await askOk(centro, `SELECT sum(total_amount) AS brutas, sum(monto_devuelto) AS devoluciones, sum(total_neto) AS netas FROM ventas_globales WHERE es_venta`);
      const { brutas, devoluciones, netas } = byBranch('Centro');
      assert.deepEqual(sales.rows[0], { brutas, devoluciones, netas });
      const received = await askOk(centro, `SELECT coalesce(sum(monto), 0) AS monto FROM devoluciones`);
      const expectedReceived = ORDERS.flatMap((o) => (o.returns ?? []).filter((r) => r.branch === 'Centro').map((r) => r.qty * priceOf(o, r.product))).reduce((a, b) => a + b, 0);
      assert.equal(received.rows[0].monto, expectedReceived);
      // La sucursal que recibió la devolución del pedido de Centro la ve; Centro Norte no ve la venta
      const norte = await askOk(api(TENANT_A.tenantId, BRANCH, branchIds['Centro Norte']), `SELECT count(*) AS n, coalesce(sum(monto), 0) AS monto FROM devoluciones`);
      assert.deepEqual(norte.rows[0], { n: 1, monto: 400 });
      const norteSales = await askOk(api(TENANT_A.tenantId, BRANCH, branchIds['Centro Norte']), `SELECT count(*) AS n FROM ventas_globales WHERE order_id = '${orderIds.O1}'`);
      assert.equal(norteSales.rows[0].n, 0);
    });

    it('moneda: los importes se informan en la del catálogo y se avisa de cobros en USDT, sin convertir', async () => {
      const body = await askOk(api(TENANT_A.tenantId, GLOBAL), `SELECT sum(total_amount) AS ventas FROM ventas_globales WHERE es_venta AND branch_id = {{sucursal:centro}}`);
      assert.equal(body.interpretation.moneda, 'BOB');
      assert.ok(body.interpretation.avisos.some((a: string) => /USDT/.test(a) && /no se convirtió/.test(a)), JSON.stringify(body.interpretation.avisos));
      const byCurrency = await askOk(
        api(TENANT_A.tenantId, GLOBAL),
        `SELECT moneda_cobro, count(*) AS pedidos, sum(total_amount) AS total FROM ventas_globales WHERE es_venta AND branch_id = {{sucursal:centro}} GROUP BY 1 ORDER BY 1`,
      );
      const usdt = byCurrency.rows.find((r: any) => r.moneda_cobro === 'USDT');
      assert.deepEqual(usdt, { moneda_cobro: 'USDT', pedidos: 1, total: 180 });
      // Una consulta sin importes no lleva el aviso
      const count = await askOk(api(TENANT_A.tenantId, GLOBAL), `SELECT count(*) AS n FROM orders WHERE branch_id = {{sucursal:centro}}`);
      assert.deepEqual(count.interpretation.avisos, []);
    });
  });

  describe('SQL simulado: nombres de sucursales y productos', () => {
    it('«Set Deportivo» no se confunde con «Set Deportivo Niña»; la interpretación lo dice', async () => {
      const body = await askOk(
        api(TENANT_A.tenantId, GLOBAL),
        `SELECT sum(cantidad) AS unidades FROM rendimiento_productos WHERE es_venta AND product_id = {{producto:set deportivo}}`,
      );
      const expected = ORDERS.filter(isSale).flatMap((o) => o.lines).filter((l) => l.product === 'Set Deportivo').reduce((s, l) => s + l.qty, 0);
      assert.equal(body.rows[0].unidades, expected);
      assert.deepEqual(body.interpretation.entidades, [{ tipo: 'producto', texto: 'set deportivo', nombre: 'Set Deportivo', metodo: 'exacto' }]);
      // El literal en un texto ya no es un problema para el validador
      assert.equal(body.sql.includes(productIds['Set Deportivo']), true);
    });

    it('nombre ambiguo: pide aclaración con las opciones y NO ejecuta la consulta', async () => {
      const res = await ask(api(TENANT_A.tenantId, GLOBAL), `SELECT count(*) AS n FROM rendimiento_productos WHERE product_id = {{producto:blusa}}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.rowCount, 0);
      assert.equal(res.body.sql, '');
      assert.match(res.body.clarification.mensaje, /varios productos que coinciden con «blusa»/);
      assert.deepEqual(res.body.clarification.opciones[0].opciones.map((o: string) => o.replace(/ \(.*\)$/, '')), ['Blusa Lino', 'Blusa Seda']);
    });

    it('dictado con errores: «yin mom» se interpreta como «Jean Mom» y se avisa', async () => {
      const body = await askOk(api(TENANT_A.tenantId, GLOBAL), `SELECT sum(cantidad_neta) AS netas FROM rendimiento_productos WHERE es_venta AND product_id = {{producto:yin mom}}`);
      const expected = ORDERS.filter(isSale).flatMap((o) => o.lines.filter((l) => l.product === 'Jean Mom').map((l) => l.qty - returnedUnits(o, 'Jean Mom'))).reduce((a, b) => a + b, 0);
      assert.equal(body.rows[0].netas, expected);
      assert.ok(body.interpretation.avisos.includes('Interpreté «yin mom» como «Jean Mom».'));
    });

    it('sucursales: mayúsculas, «sucursal», parciales y varias en la misma consulta', async () => {
      const body = await askOk(
        api(TENANT_A.tenantId, GLOBAL),
        `SELECT b.name AS sucursal FROM branches b WHERE b.id IN ({{sucursal:CENTRO}}, {{sucursal:la sucursal sur}}, {{sucursal:norte}}) ORDER BY 1`,
      );
      assert.deepEqual(body.rows.map((r: any) => r.sucursal), ['Centro', 'Centro Norte', 'Sucursal Sur']);
    });

    it('inexistente: lo dice y no ejecuta nada; un marcador con comillas no inyecta SQL', async () => {
      const missing = await ask(api(TENANT_A.tenantId, GLOBAL), `SELECT count(*) AS n FROM orders WHERE branch_id = {{sucursal:cochabamba}}`);
      assert.match(missing.body.clarification.mensaje, /No encontré la sucursal «cochabamba» entre las sucursales de la tienda/);
      const injection = await ask(api(TENANT_A.tenantId, GLOBAL), `SELECT count(*) AS n FROM products WHERE id = {{producto:x' OR '1'='1}}`);
      assert.equal(injection.status, 200);
      assert.ok(injection.body.clarification, 'se trata como un nombre más, no como SQL');
      const malformed = await ask(api(TENANT_A.tenantId, GLOBAL), `SELECT count(*) AS n FROM orders WHERE branch_id = {{sucursal:centro`);
      assert.equal(malformed.status, 403);
    });

    it('solo dentro del ámbito: otra sucursal existente es "sin permiso"; una inexistente pide aclaración; cada tienda resuelve su «Centro»', async () => {
      const centroUser = api(TENANT_A.tenantId, BRANCH, branchIds.Centro);
      const other = await ask(centroUser, `SELECT count(*) AS n FROM orders WHERE branch_id = {{sucursal:sur}}`);
      assert.equal(other.status, 200);
      assert.equal(other.body.estado, 'sin_permiso');
      assert.match(other.body.clarification.mensaje, /No tienes acceso a «Sucursal Sur»/);
      assert.equal(other.body.rowCount, 0);
      const missing = await ask(centroUser, `SELECT count(*) AS n FROM orders WHERE branch_id = {{sucursal:cochabamba}}`);
      assert.equal(missing.body.estado, 'aclaracion');
      assert.match(missing.body.clarification.mensaje, /entre las sucursales a las que tienes acceso/);
      const own = await askOk(centroUser, `SELECT count(*) AS n FROM orders WHERE branch_id = {{sucursal:centro}}`);
      assert.equal(own.rows[0].n, ORDERS.filter((o) => o.branch === 'Centro').length);

      const storeB = await askOk(api(TENANT_B.tenantId, GLOBAL), `SELECT count(*) AS n, max(total_amount) AS maximo FROM orders WHERE branch_id = {{sucursal:centro}}`);
      assert.deepEqual(storeB.rows[0], { n: 1, maximo: 9999 });
      assert.ok(storeB.sql.includes(branchIds.storeB) && !storeB.sql.includes(branchIds.Centro));
    });
  });

  // ===========================================================================================
  describe('SQL simulado: estados distinguibles (sin datos, aclaración, sin permiso, falló)', () => {
    it('sin datos: sin filas o todo NULL; un 0 calculado es un resultado, no "sin datos"', async () => {
      const nulls = await askOk(api(TENANT_A.tenantId, GLOBAL), `SELECT sum(total_amount) AS ventas FROM ventas_globales WHERE es_venta AND created_at >= '2024-01-01' AND created_at < '2024-02-01'`);
      assert.equal(nulls.estado, 'sin_datos');
      const empty = await askOk(api(TENANT_A.tenantId, GLOBAL), `SELECT order_number FROM orders WHERE created_at < '2000-01-01' LIMIT 5`);
      assert.deepEqual([empty.estado, empty.rowCount], ['sin_datos', 0]);
      const zero = await askOk(api(TENANT_A.tenantId, GLOBAL), `SELECT coalesce(sum(total_amount), 0) AS ventas FROM ventas_globales WHERE es_venta AND created_at >= '2024-01-01' AND created_at < '2024-02-01'`);
      assert.deepEqual([zero.estado, zero.rows[0].ventas], ['ok', 0]);
    });

    it('aclaración y "no se puede responder" son estados propios, no errores ni tablas', async () => {
      const ambiguous = await ask(api(TENANT_A.tenantId, GLOBAL), `SELECT count(*) AS n FROM rendimiento_productos WHERE product_id = {{producto:blusa}}`);
      assert.deepEqual([ambiguous.status, ambiguous.body.estado], [200, 'aclaracion']);
      const unanswerable = await ask(api(TENANT_A.tenantId, GLOBAL), `SELECT 'No puedo responder esa pregunta con los datos disponibles' AS mensaje`);
      assert.deepEqual([unanswerable.status, unanswerable.body.estado], [200, 'no_respondible']);
    });

    it('errores con código: consulta rechazada (403) ≠ falló al ejecutar (400) ≠ sin permiso del rol (403 sin código de reporte)', async () => {
      const rejected = await ask(api(TENANT_A.tenantId, GLOBAL), `SELECT * FROM payments`);
      assert.deepEqual([rejected.status, rejected.body.code], [403, 'REPORT_QUERY_REJECTED']);
      const failed = await ask(api(TENANT_A.tenantId, GLOBAL), `SELECT columna_inexistente FROM orders`);
      assert.deepEqual([failed.status, failed.body.code], [400, 'REPORT_QUERY_FAILED']);
      const noRole = await ask(api(TENANT_A.tenantId, ['VIEW_ORDERS']), `SELECT 1 AS x`);
      assert.equal(noRole.status, 403);
      assert.ok(!String(noRole.body.code ?? '').startsWith('REPORT_'), JSON.stringify(noRole.body));
      const unknownBranch = await ask(api(TENANT_A.tenantId, BRANCH, randomUUID()), `SELECT 1 AS x`);
      assert.deepEqual([unknownBranch.status, unknownBranch.body.code], [403, 'REPORT_BRANCH_UNKNOWN']);
    });
  });

  describe('fechas escritas por la app (Prisma) en una sesión con zona La Paz', () => {
    it('la app guarda UTC sin zona; la venta de las 23:59:30 locales de ayer cae en "ayer" y no en hoy', async () => {
      // El clúster de pruebas tiene TimeZone = America/La_Paz: si la app dependiera del DEFAULT de la base
      // (CURRENT_TIMESTAMP en un timestamp sin zona), guardaría la hora LOCAL. Se escribe con el PrismaService real.
      const [{ tz }] = await queryRows<{ tz: string }>(`SELECT current_setting('TimeZone') AS tz`);
      const prisma = app.get(PrismaService, { strict: false });
      const lateInstant = laPaz(yesterday.y, yesterday.m, yesterday.d, 23, 59, 30);
      const [userRow] = await queryRows<{ id: string }>(`SELECT id FROM ${sA}.users WHERE email LIKE '%@test.local' LIMIT 1`);
      const { late, nowOrder } = await runInTenant(TENANT_A, async () => {
        const late = await prisma.order.create({
          data: { orderNumber: `ACC-PRISMA-${randomUUID().slice(0, 6)}`, status: 'ENTREGADO', totalAmount: 77, userId: userRow.id, branchId: branchIds['Sucursal Sur'], createdAt: lateInstant },
        });
        // Sin createdAt: lo pone Prisma (now) como lo hace toda la app
        const nowOrder = await prisma.order.create({
          data: { orderNumber: `ACC-PRISMA-${randomUUID().slice(0, 6)}`, status: 'PENDIENTE', totalAmount: 1, userId: userRow.id, branchId: branchIds['Sucursal Sur'] },
        });
        return { late, nowOrder };
      });
      created.push({ table: 'orders', schema: sA, id: late.id }, { table: 'orders', schema: sA, id: nowOrder.id });
      try {

      // Lo guardado es la hora UTC (no la local), con independencia de la zona de la sesión
      const stored = await queryRows<{ id: string; raw: string; utc_now: string }>(
        `SELECT id, "createdAt"::text AS raw, (now() AT TIME ZONE 'UTC')::text AS utc_now FROM ${sA}.orders WHERE id = ANY($1)`,
        [[late.id, nowOrder.id]],
      );
      const rawOf = (id: string) => stored.find((s) => s.id === id)!.raw;
      assert.equal(tz, 'America/La_Paz');
      assert.equal(rawOf(late.id).slice(0, 19), lateInstant.toISOString().slice(0, 19).replace('T', ' '));
      const drift = Math.abs(new Date(`${rawOf(nowOrder.id).replace(' ', 'T')}Z`).getTime() - new Date(`${stored[0].utc_now.replace(' ', 'T')}Z`).getTime());
      assert.ok(drift < 60_000, `createdAt por defecto a ${drift} ms de la hora UTC: se guardó hora local`);

      // Y el reporte la ubica en el día LOCAL correcto (ayer), comparando con instantes absolutos
      const body = await askOk(
        api(TENANT_A.tenantId, GLOBAL),
        `SELECT to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') AS local, created_at >= current_date - 1 AND created_at < current_date AS es_ayer
         FROM orders WHERE id = '${late.id}'`,
      );
      const pad = (n: number) => String(n).padStart(2, '0');
      assert.deepEqual(body.rows[0], { local: `${yesterday.y}-${pad(yesterday.m)}-${pad(yesterday.d)} 23:59:30`, es_ayer: true });
      } finally {
        // Se borran ya: no deben sumar en los casos siguientes (ventas de ayer en Sur)
        await queryRows(`DELETE FROM ${sA}.orders WHERE id = ANY($1)`, [[late.id, nowOrder.id]]);
      }
    });
  });

  describe('marcadores: sustitución segura', () => {
    it('dentro de un texto, como tabla o en un comentario no inyectan nada', async () => {
      const inLiteral = await ask(api(TENANT_A.tenantId, GLOBAL), `SELECT count(*) AS n FROM orders WHERE order_number = '{{sucursal:centro}}'`);
      assert.deepEqual([inLiteral.status, inLiteral.body.code], [403, 'REPORT_QUERY_REJECTED']);
      const asTable = await ask(api(TENANT_A.tenantId, GLOBAL), `SELECT count(*) AS n FROM {{sucursal:centro}}`);
      assert.deepEqual([asTable.status, asTable.body.code], [403, 'REPORT_QUERY_REJECTED']);
      const inComment = await askOk(api(TENANT_A.tenantId, GLOBAL), `SELECT count(*) AS n FROM orders WHERE branch_id = {{sucursal:centro}} -- {{sucursal:norte}}`);
      assert.equal(inComment.rows[0].n, ORDERS.filter((o) => o.branch === 'Centro').length);
    });

    it('el id sustituido es un literal y la consulta final vuelve a pasar el validador y el ámbito', async () => {
      // Un marcador resuelto no puede abrir la puerta a otra sucursal: el ámbito sigue siendo el del usuario
      const centroUser = api(TENANT_A.tenantId, BRANCH, branchIds.Centro);
      const body = await askOk(centroUser, `SELECT count(*) AS n FROM orders WHERE branch_id = {{sucursal:centro}} OR branch_id <> {{sucursal:centro}}`);
      assert.equal(body.rows[0].n, ORDERS.filter((o) => o.branch === 'Centro').length);
      assert.match(body.sql, new RegExp(`branch_id = '${branchIds.Centro}'`));
      // Tras sustituir, una función prohibida sigue rechazándose
      const sneaky = await ask(centroUser, `SELECT set_config('app.branch_id', {{sucursal:centro}}, true) AS x`);
      assert.deepEqual([sneaky.status, sneaky.body.code], [403, 'REPORT_QUERY_REJECTED']);
    });
  });

  // ===========================================================================================
  // GROQ REAL: cada caso llama al modelo una vez. Se registra la pregunta, el SQL generado, lo esperado
  // (calculado aquí desde los datos sembrados), lo obtenido y los controles. GROQ_REPORT_FILE guarda el informe.
  describe('Groq real (solo con GROQ_TEST_API_KEY)', { skip: process.env.GROQ_TEST_API_KEY ? false : 'Sin GROQ_TEST_API_KEY: no se llama al modelo real' }, () => {
    type Body = { estado?: string; sql?: string; rows?: Record<string, unknown>[]; interpretation?: { entidades: { tipo: string; nombre: string }[]; avisos: string[] }; clarification?: { mensaje: string }; code?: string; message?: string };
    interface Case {
      id: string;
      pregunta: string;
      esperado: string;
      branch?: string; // usuario limitado a esa sucursal
      check: (res: { status: number; body: Body }, generated: string) => string | null; // null = correcto; texto = motivo del fallo
      controles?: (generated: string, body: Body) => Record<string, boolean | string>;
    }
    const report: Record<string, unknown>[] = [];
    let calls = 0;
    const usage: { prompt: number; completion: number; total: number } = { prompt: 0, completion: 0, total: 0 };
    let lastGenerated = '';

    const nums = (rows: Record<string, unknown>[] = []) => rows.flatMap((r) => Object.values(r)).filter((v): v is number => typeof v === 'number');
    const has = (rows: Record<string, unknown>[] | undefined, value: number) => nums(rows).some((n) => Math.abs(n - value) < 0.005);
    const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const rowWith = (rows: Record<string, unknown>[] | undefined, name: string) => (rows ?? []).find((r) => Object.values(r).some((v) => norm(v) === norm(name)));
    const ok = (res: { status: number; body: Body }) => (res.status !== 200 ? `HTTP ${res.status} ${res.body.code ?? ''} ${res.body.message ?? ''}` : null);
    const expectNumber = (value: number, estado = 'ok') => (res: { status: number; body: Body }) =>
      ok(res) ?? (res.body.estado !== estado ? `estado ${res.body.estado}` : has(res.body.rows, value) ? null : `no aparece ${value} en ${JSON.stringify(res.body.rows)}`);
    const markers = (generated: string) => (generated.match(/\{\{\s*(sucursal|producto|categoria)\s*:[^}]*\}\}/gi) ?? []).join(' ');
    const usesSaleRule = (generated: string) => /es_venta|status\s+IN\s*\(\s*'PROCESANDO'/i.test(generated);

    const cal = buildReportCalendar(new Date(), 'America/La_Paz');
    const localKey = (d: Date) => new Date(d.getTime() - LA_PAZ_OFFSET_H * 3600 * 1000).toISOString().slice(0, 10);
    const sales = ORDERS.filter(isSale);
    const sum = (list: number[]) => list.reduce((a, b) => a + b, 0);
    const unitsOf = (product: string) => sum(sales.flatMap((o) => o.lines.filter((l) => l.product === product).map((l) => l.qty)));
    // Mes pasado calculado aparte: del mes local de hoy (UTC-4 fijo) se resta uno
    const prevMonth = today.m === 1 ? { y: today.y - 1, m: 12 } : { y: today.y, m: today.m - 1 };
    const inPrevMonth = (d: Date) => localKey(d).startsWith(`${prevMonth.y}-${String(prevMonth.m).padStart(2, '0')}`);

    const cases: Case[] = [
      {
        id: 'G01', pregunta: '¿Cuánto se vendió ayer en la sucursal Sur?', esperado: `Bs ${sum(ORDERS.filter((o) => ['Y1', 'Y2'].includes(o.key)).map(gross))} (2 ventas de 00:00:30 y 23:59:30 locales)`,
        check: expectNumber(sum(ORDERS.filter((o) => ['Y1', 'Y2'].includes(o.key)).map(gross))),
        controles: (g) => ({ marcadorSucursal: /\{\{sucursal:/i.test(g), rangoAyer: g.includes(cal.ayer.desde) || /current_date\s*-\s*(interval\s*'1 day'|1)/i.test(g), reglaVenta: usesSaleRule(g), sinAtTimeZone: !/at time zone/i.test(g) }),
      },
      {
        id: 'G02', pregunta: '¿Cuántos pedidos pagados hubo ayer en la sucursal Sur?', esperado: '2 (la venta de las 00:00:30 de hoy no cuenta)',
        check: expectNumber(2),
        controles: (g) => ({ marcadorSucursal: /\{\{sucursal:/i.test(g), reglaVenta: usesSaleRule(g) }),
      },
      {
        id: 'G03', pregunta: '¿Cuánto se vendió el mes pasado en la sucursal Centro?',
        esperado: `Bs ${sum(sales.filter((o) => o.branch === 'Centro' && inPrevMonth(o.at)).map(gross))} (incluye la venta de las 23:30 del último día del mes)`,
        check: (res) => {
          const value = sum(sales.filter((o) => o.branch === 'Centro' && inPrevMonth(o.at)).map(gross));
          return value === 0 ? ok(res) ?? (['sin_datos', 'ok'].includes(res.body.estado!) && (res.body.estado === 'sin_datos' || has(res.body.rows, 0)) ? null : 'esperaba 0 o sin datos') : expectNumber(value)(res);
        },
        controles: (g) => ({ marcadorSucursal: /\{\{sucursal:/i.test(g), rangoMesPasado: g.includes(cal.mesPasado.desde) && g.includes(cal.mesPasado.hasta), reglaVenta: usesSaleRule(g) }),
      },
      {
        id: 'G04', pregunta: 'Ventas totales por sucursal', esperado: BRANCHES.map((b) => `${b}: Bs ${sum(sales.filter((o) => o.branch === b).map(gross))}`).join('; '),
        check: (res) => ok(res) ?? (BRANCHES.every((b) => { const row = rowWith(res.body.rows, b); return row && has([row], sum(sales.filter((o) => o.branch === b).map(gross))); }) ? null : `filas: ${JSON.stringify(res.body.rows)}`),
        controles: (g) => ({ reglaVenta: usesSaleRule(g), agrupa: /group by/i.test(g) }),
      },
      {
        id: 'G05', pregunta: '¿Cuántas unidades se vendieron de cada producto?', esperado: Object.keys(PRODUCTS).map((p) => `${p}: ${unitsOf(p)}`).join('; '),
        check: (res) => ok(res) ?? (Object.keys(PRODUCTS).every((p) => { const row = rowWith(res.body.rows, p); return row && has([row], unitsOf(p)); }) ? null : `filas: ${JSON.stringify(res.body.rows)}`),
        controles: (g) => ({ reglaVenta: usesSaleRule(g), agrupa: /group by/i.test(g) }),
      },
      {
        id: 'G06', pregunta: '¿Qué categorías vendieron más de 3 unidades netas en cada sucursal? Muestra sucursal, categoría y unidades netas.',
        esperado: 'Centro / Deportivo: 4; Sucursal Sur / Blusas: 5 (solo esas dos)',
        check: (res) => {
          const err = ok(res);
          if (err) return err;
          const rows = res.body.rows ?? [];
          const centro = rows.find((r) => Object.values(r).some((v) => norm(v) === 'centro') && Object.values(r).some((v) => norm(v) === 'deportivo'));
          const sur = rows.find((r) => Object.values(r).some((v) => norm(v) === 'sucursal sur') && Object.values(r).some((v) => norm(v) === 'blusas'));
          return rows.length === 2 && centro && has([centro], 4) && sur && has([sur], 5) ? null : `filas: ${JSON.stringify(rows)}`;
        },
        controles: (g) => ({ having: /having/i.test(g), agrupa: /group by/i.test(g), netas: /cantidad_neta/i.test(g), reglaVenta: usesSaleRule(g) }),
      },
      {
        id: 'G07', pregunta: '¿Cuántas unidades de Set Deportivo se vendieron?', esperado: `${unitsOf('Set Deportivo')} (no cuenta «Set Deportivo Niña» ni el pedido cancelado)`,
        check: (res, g) => expectNumber(unitsOf('Set Deportivo'))(res) ?? (res.body.interpretation?.entidades.some((e) => e.nombre === 'Set Deportivo') ? null : `marcador: ${markers(g)}`),
        controles: (g, b) => ({ marcadorProducto: /\{\{producto:/i.test(g), resueltoA: b.interpretation?.entidades.map((e) => e.nombre).join(', ') ?? '' }),
      },
      {
        id: 'G08', pregunta: '¿Cuántas unidades de set deportivo niña se vendieron?', esperado: `${unitsOf('Set Deportivo Niña')} (el pedido pendiente no cuenta)`,
        check: (res, g) => expectNumber(unitsOf('Set Deportivo Niña'))(res) ?? (res.body.interpretation?.entidades.some((e) => e.nombre === 'Set Deportivo Niña') ? null : `marcador: ${markers(g)}`),
        controles: (g, b) => ({ marcadorProducto: /\{\{producto:/i.test(g), resueltoA: b.interpretation?.entidades.map((e) => e.nombre).join(', ') ?? '' }),
      },
      {
        id: 'G09', pregunta: '¿Cuánto se devolvió en la sucursal Centro Norte?', esperado: 'Bs 400 (devolución parcial de Jean Mom de una venta de Centro, recibida en Centro Norte)',
        check: expectNumber(400),
        controles: (g) => ({ vistaDevoluciones: /\b(from|join)\s+devoluciones\b/i.test(g), marcadorSucursal: /\{\{sucursal:/i.test(g) }),
      },
      {
        id: 'G10', pregunta: '¿Cuánto se devolvió de las ventas de la sucursal Centro?', esperado: `Bs ${sum(sales.filter((o) => o.branch === 'Centro').map(refunded))} (incluye lo devuelto en otra sucursal)`,
        check: expectNumber(sum(sales.filter((o) => o.branch === 'Centro').map(refunded))),
        controles: (g) => ({ montoDevuelto: /monto_devuelto/i.test(g), marcadorSucursal: /\{\{sucursal:/i.test(g) }),
      },
      {
        id: 'G11', pregunta: '¿Cuáles fueron las ventas netas de la sucursal Centro?', esperado: `Bs ${sum(sales.filter((o) => o.branch === 'Centro').map((o) => gross(o) - refunded(o)))}`,
        check: expectNumber(sum(sales.filter((o) => o.branch === 'Centro').map((o) => gross(o) - refunded(o)))),
        controles: (g) => ({ totalNeto: /total_neto/i.test(g), reglaVenta: usesSaleRule(g) }),
      },
      {
        id: 'G12', pregunta: '¿Cuánto se vendió en enero de 2024?', esperado: 'sin datos (o 0): no hay ventas en ese período',
        check: (res) => ok(res) ?? (res.body.estado === 'sin_datos' || (res.body.estado === 'ok' && nums(res.body.rows).every((n) => n === 0)) ? null : `estado ${res.body.estado}: ${JSON.stringify(res.body.rows)}`),
        controles: (g) => ({ rangoEnero2024: g.includes('2024-01-01') && g.includes('2024-02-01') }),
      },
      {
        id: 'G13', pregunta: '¿Cuánto vendió la blusa?', esperado: 'aclaración: Blusa Lino o Blusa Seda',
        check: (res, g) => ok(res) ?? (res.body.estado === 'aclaracion' && /Blusa Lino/.test(res.body.clarification?.mensaje ?? '') ? null : `estado ${res.body.estado}; marcadores: ${markers(g)}`),
        controles: (g) => ({ marcadorProducto: /\{\{producto:/i.test(g) }),
      },
      {
        id: 'G14', pregunta: '¿Cuánto vendió la sucursal Cochabamba?', esperado: 'aclaración: no existe esa sucursal',
        check: (res) => ok(res) ?? (res.body.estado === 'aclaracion' && /No encontré la sucursal/.test(res.body.clarification?.mensaje ?? '') ? null : `estado ${res.body.estado}`),
        controles: (g) => ({ marcadorSucursal: /\{\{sucursal:/i.test(g) }),
      },
      {
        id: 'G15', pregunta: '¿Cuánto vendió la sucursal Sur?', branch: 'Centro', esperado: 'sin permiso (el usuario solo ve Centro); no se consulta nada',
        check: (res) => ok(res) ?? (res.body.estado === 'sin_permiso' ? null : `estado ${res.body.estado}: ${JSON.stringify(res.body.rows)}`),
        controles: (g) => ({ marcadorSucursal: /\{\{sucursal:/i.test(g) }),
      },
      {
        id: 'G16', pregunta: '¿Cuánto se cobró en USDT?', esperado: 'Bs 180 (importe en la moneda del catálogo; sin conversión)',
        check: expectNumber(180),
        controles: (g, b) => ({ monedaCobro: /moneda_cobro|metodo_pago/i.test(g), avisoSinConversion: (b.interpretation?.avisos ?? []).some((a) => /no se convirtió/.test(a)) }),
      },
      {
        id: 'G17', pregunta: '¿Cuántos pedidos pendientes hay?', esperado: `${ORDERS.filter((o) => o.status === 'PENDIENTE').length}`,
        check: expectNumber(ORDERS.filter((o) => o.status === 'PENDIENTE').length),
        controles: (g) => ({ estadoPendiente: /'PENDIENTE'/.test(g) }),
      },
    ];

    before(() => {
      process.env.GROQ_API_KEY = process.env.GROQ_TEST_API_KEY;
      service.generateSql = async (prompt, context) => {
        lastContext = context;
        lastGenerated = '';
        calls += 1;
        try {
          lastGenerated = await realGenerateSql(prompt, context);
          return lastGenerated;
        } finally {
          const info = (service as unknown as { lastGroqCall: { promptTokens: number | null; completionTokens: number | null; totalTokens: number | null } | null }).lastGroqCall;
          usage.prompt += info?.promptTokens ?? 0;
          usage.completion += info?.completionTokens ?? 0;
          usage.total += info?.totalTokens ?? 0;
        }
      };
    });
    after(() => {
      process.env.GROQ_API_KEY = '';
      service.generateSql = async (_prompt, context) => {
        lastContext = context;
        return nextSql;
      };
      const summary = { llamadas: calls, tokens: usage, modelo: process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b', casos: report };
      if (process.env.GROQ_REPORT_FILE) writeFileSync(process.env.GROQ_REPORT_FILE, JSON.stringify(summary, null, 2), 'utf8');
      console.log(`Groq real: ${calls} llamadas, ${usage.total} tokens (${usage.prompt} de entrada + ${usage.completion} de salida)`);
    });

    for (const c of cases) {
      it(`${c.id}: ${c.pregunta}`, async () => {
        const client = c.branch ? api(TENANT_A.tenantId, BRANCH, branchIds[c.branch]) : api(TENANT_A.tenantId, GLOBAL);
        const res = await client.call('POST', '/reports/dynamic', { body: { prompt: c.pregunta } });
        const fallo = c.check(res, lastGenerated);
        const info = (service as unknown as { lastGroqCall: unknown }).lastGroqCall;
        report.push({
          id: c.id,
          pregunta: c.pregunta,
          usuario: c.branch ? `solo ${c.branch}` : 'todas las sucursales',
          esperado: c.esperado,
          http: res.status,
          estado: res.body.estado ?? res.body.code ?? null,
          obtenido: res.body.clarification?.mensaje ?? res.body.rows ?? res.body.message,
          sqlGenerado: lastGenerated,
          sqlEjecutado: res.body.sql ?? null,
          entidades: res.body.interpretation?.entidades ?? [],
          avisos: res.body.interpretation?.avisos ?? [],
          controles: c.controles?.(lastGenerated, res.body) ?? {},
          groq: info,
          resultado: fallo ? `FALLA: ${fallo}` : 'OK',
        });
        assert.equal(fallo, null, fallo ?? '');
      });
    }
  });
});
