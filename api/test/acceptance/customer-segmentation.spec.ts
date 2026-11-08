import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Api, TENANT_A, TENANT_B, bootApp, queryRows, seedTenant, type Fixture } from './support/world';
import { TenantResolutionCache } from '../../src/tenancy/tenant-resolution-cache.service';
import { WALK_IN_CUSTOMER_EMAIL } from '../../src/modules/pos/pos.service';

// Segmentación de clientes (IA/ANS) por HTTP: plan, permisos, estados, ejecución duplicada, aislamiento entre
// tiendas y separación demo/real. Ejecuta el Python REAL (IA/ANS/.venv) sobre una copia del paquete en una
// carpeta temporal, así que no escribe nada en IA/ANS/salidas. Sin el entorno virtual la suite se omite.
const REPO_ANS = resolve(__dirname, '..', '..', '..', '..', 'IA', 'ANS');
const PYTHON = join(REPO_ANS, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const HAS_PYTHON = existsSync(PYTHON);
const ROOT = mkdtempSync(join(tmpdir(), 'segmentation-acceptance-'));
if (HAS_PYTHON) cpSync(join(REPO_ANS, 'segmentacion_clientes'), join(ROOT, 'segmentacion_clientes'), { recursive: true });
process.env.SEGMENTATION_DIR = ROOT;
process.env.SEGMENTATION_PYTHON = PYTHON;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DAY = 24 * 60 * 60 * 1000;

describe('Segmentación de clientes: /reports/segments', { skip: HAS_PYTHON ? false : 'Falta IA/ANS/.venv' }, () => {
  let app: INestApplication;
  let base: string;
  let fxA: Fixture;

  const token = (tenantId: string, permissions: string[], branchId: string | null = null) =>
    app.get(JwtService, { strict: false }).sign(
      { sub: randomUUID(), email: 's@test.local', role: { id: randomUUID(), name: 'Gerente' }, permissions, branchId, tenantId },
      { secret: process.env.JWT_SECRET, expiresIn: 3600 },
    );
  const api = (tenantId: string, permissions: string[], branchId: string | null = null) => new Api(base, tenantId, token(tenantId, permissions, branchId));
  const GLOBAL = ['VIEW_REPORTS', 'ALL_BRANCHES'];
  const setPlan = async (tenantId: string, plan: string) => {
    await queryRows('UPDATE public.tenants SET plan=$2 WHERE id=$1', [tenantId, plan]);
    app.get(TenantResolutionCache, { strict: false }).invalidate(tenantId);
  };
  const waitDone = async (client: Api, source: 'real' | 'demo') => {
    for (let i = 0; i < 180; i++) {
      const res = await client.call('GET', `/reports/segments?source=${source}`);
      if (res.body.status !== 'entrenando') return res;
      await sleep(1000);
    }
    throw new Error('El entrenamiento no terminó a tiempo');
  };
  const schemaA = `"${TENANT_A.schemaName}"`;
  const addUser = async (email = `${randomUUID()}@test.local`) => {
    const id = randomUUID();
    await queryRows(`INSERT INTO ${schemaA}.users (id,email,password,"roleId","updatedAt") VALUES ($1,$2,'x',$3,now())`, [id, email, fxA.roleId]);
    return id;
  };
  const addOrder = async (userId: string, status: string, daysAgo: number, amount: number) =>
    queryRows(
      `INSERT INTO ${schemaA}.orders (id,"orderNumber",status,"totalAmount","userId","branchId","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,now())`,
      [randomUUID(), `seg-${randomUUID()}`, status, amount, userId, fxA.branchA, new Date(Date.now() - daysAgo * DAY)],
    );

  before(async () => {
    app = await bootApp();
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    fxA = await seedTenant(TENANT_A.schemaName);
    await seedTenant(TENANT_B.schemaName);
  });
  after(async () => {
    await setPlan(TENANT_A.tenantId, 'free').catch(() => undefined);
    await setPlan(TENANT_B.tenantId, 'free').catch(() => undefined);
    await app?.close();
    rmSync(ROOT, { recursive: true, force: true });
  });

  it('exige un plan con aiReports y el permiso VIEW_REPORTS', async () => {
    await setPlan(TENANT_A.tenantId, 'starter');
    assert.equal((await api(TENANT_A.tenantId, GLOBAL).call('GET', '/reports/segments?source=demo')).status, 403);
    await setPlan(TENANT_A.tenantId, 'pro');
    await setPlan(TENANT_B.tenantId, 'pro');
    assert.equal((await api(TENANT_A.tenantId, ['ALL_BRANCHES']).call('GET', '/reports/segments?source=demo')).status, 403);
    assert.equal((await new Api(base, TENANT_A.tenantId).call('GET', '/reports/segments?source=demo')).status, 401);
  });

  it('sin alcance global no consulta, no entrena ni borra (mensaje traducido)', async () => {
    const branchUser = api(TENANT_A.tenantId, ['VIEW_REPORTS'], fxA.branchA);
    const es = await branchUser.call('GET', '/reports/segments?source=demo');
    assert.equal(es.status, 403);
    assert.match(es.body.message, /todas las sucursales/);
    const en = await branchUser.call('POST', '/reports/segments/train', { body: { source: 'demo' }, headers: { 'accept-language': 'en' } });
    assert.equal(en.status, 403);
    assert.match(en.body.message, /all branches/);
    const fr = await branchUser.call('DELETE', '/reports/segments/demo', { headers: { 'accept-language': 'fr' } });
    assert.equal(fr.status, 403);
    assert.match(fr.body.message, /toutes les succursales/);
  });

  it('valida el origen y consultar no entrena', async () => {
    const a = api(TENANT_A.tenantId, GLOBAL);
    assert.equal((await a.call('GET', '/reports/segments?source=../real')).status, 400);
    const res = await a.call('GET', '/reports/segments?source=demo');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'sin_entrenar');
    assert.equal(res.body.simulated, true);
    assert.equal(res.body.result, null);
    assert.equal(existsSync(join(ROOT, 'salidas', 'web', 'demo', TENANT_A.tenantId)), false);
  });

  it('demo: entrena una vez, rechaza la ejecución simultánea y queda "listo" con 80/20 por cliente', async () => {
    const a = api(TENANT_A.tenantId, GLOBAL);
    const [first, second] = await Promise.all([
      a.call('POST', '/reports/segments/train', { body: { source: 'demo' } }),
      a.call('POST', '/reports/segments/train', { body: { source: 'demo' } }),
    ]);
    assert.deepEqual([first.status, second.status].sort(), [202, 409]);
    assert.equal((await a.call('POST', '/reports/segments/train', { body: { source: 'real' } })).status, 409);

    const done = await waitDone(a, 'demo');
    assert.equal(done.body.status, 'listo', JSON.stringify(done.body).slice(0, 300));
    const r = done.body.result;
    assert.equal(r.origen, 'simulado');
    assert.equal(r.tienda_id, TENANT_A.tenantId);
    assert.ok(r.division.total >= 100);
    assert.equal(r.division.entrenamiento, Math.floor((r.division.total * 8) / 10));
    assert.equal(r.division.entrenamiento + r.division.evaluacion, r.division.total);
    assert.equal(r.division.total, r.datos.clientes.elegibles);
    assert.ok(r.grupos.length >= 2);
    assert.equal(r.grupos.reduce((s: number, g: { clientes: number }) => s + g.clientes, 0), r.division.total);
    assert.equal(typeof r.metricas.entrenamiento.silhouette, 'number');
    // Solo agregados: ningún identificador de cliente viaja al navegador
    assert.doesNotMatch(JSON.stringify(done.body), /cliente_id|-c0\d{3}/);
  });

  it('otra tienda no ve los grupos, aunque cambie identificadores', async () => {
    const b = api(TENANT_B.tenantId, GLOBAL);
    const res = await b.call('GET', `/reports/segments?source=demo&tenantId=${TENANT_A.tenantId}`);
    assert.equal(res.body.status, 'sin_entrenar');
    assert.equal(res.body.result, null);
    // Token de A enviado a la tienda B: rechazado por JwtStrategy
    const crossed = new Api(base, TENANT_B.tenantId, token(TENANT_A.tenantId, GLOBAL));
    assert.equal((await crossed.call('GET', '/reports/segments?source=demo')).status, 401);
    // Un resultado de A copiado por error en la carpeta de B no se devuelve
    const dirB = join(ROOT, 'salidas', 'web', 'demo', TENANT_B.tenantId);
    mkdirSync(dirB, { recursive: true });
    cpSync(join(ROOT, 'salidas', 'web', 'demo', TENANT_A.tenantId, 'resultado'), join(dirB, 'resultado'), { recursive: true });
    assert.equal((await b.call('GET', '/reports/segments?source=demo')).body.result, null);
    rmSync(dirB, { recursive: true, force: true });
  });

  it('real: pocos clientes -> datos_insuficientes; excluye consumidor final, pendientes y cancelados; sin datos personales', async () => {
    const ana = await addUser('ana.real@test.local');
    const beto = await addUser();
    const walkIn = await addUser(WALK_IN_CUSTOMER_EMAIL);
    await addOrder(ana, 'ENTREGADO', 10, 100);
    await addOrder(ana, 'PROCESANDO', 3, 50);
    await addOrder(ana, 'CANCELADO', 2, 999);
    await addOrder(beto, 'PENDIENTE', 1, 80);
    await addOrder(walkIn, 'ENTREGADO', 5, 300);

    const a = api(TENANT_A.tenantId, GLOBAL);
    assert.equal((await a.call('POST', '/reports/segments/train', { body: { source: 'real' } })).status, 202);
    const done = await waitDone(a, 'real');
    assert.equal(done.body.status, 'datos_insuficientes');
    assert.equal(done.body.simulated, false);
    const r = done.body.result;
    assert.equal(r.origen, 'real');
    assert.equal(r.codigo_motivo, 'pocos_clientes');
    assert.equal(r.datos.clientes.elegibles, 1); // solo ana
    assert.equal(r.datos.pedidos.validos_en_periodo, 2);
    assert.equal(r.datos.pedidos.cancelados, 1);
    assert.equal(r.datos.pedidos.pendientes, 1);
    assert.deepEqual(r.grupos, []);

    const entrada = join(ROOT, 'salidas', 'web', 'real', TENANT_A.tenantId, 'entrada');
    const archivos = ['pedidos.csv', 'clientes.csv', 'devoluciones.csv', 'origen.json'].map((f) => readFileSync(join(entrada, f), 'utf8')).join('\n');
    assert.doesNotMatch(archivos, /@|ana\.real/);
    assert.ok(!archivos.includes(ana) && !archivos.includes(walkIn));
    assert.equal(JSON.parse(readFileSync(join(entrada, 'origen.json'), 'utf8')).pedidos_consumidor_final_excluidos, 1);

    // La demo sigue intacta y marcada como simulada
    const demo = await a.call('GET', '/reports/segments?source=demo');
    assert.equal(demo.body.status, 'listo');
    assert.equal(demo.body.result.origen, 'simulado');
  });

  it('real: con historial suficiente entrena con las compras de la tienda', async () => {
    for (let i = 0; i < 45; i++) {
      const user = await addUser();
      const orders = i % 3 === 0 ? 8 : i % 3 === 1 ? 3 : 1;
      for (let j = 0; j < orders; j++) {
        await addOrder(user, 'ENTREGADO', (i % 3 === 2 ? 200 : 5) + (i % 7) + j * 25, (i % 3 === 0 ? 900 : 150) + (i % 5) * 10);
      }
    }
    const a = api(TENANT_A.tenantId, GLOBAL);
    assert.equal((await a.call('POST', '/reports/segments/train', { body: { source: 'real' } })).status, 202);
    const done = await waitDone(a, 'real');
    assert.equal(done.body.status, 'listo', JSON.stringify(done.body.result?.motivo));
    const r = done.body.result;
    assert.equal(r.division.total, 46); // 45 + ana
    assert.equal(r.division.entrenamiento, 36);
    assert.equal(r.moneda, (process.env.PAYMENT_CURRENCY ?? 'bob').toUpperCase()); // moneda de cobro de la tienda
  });

  it('borrar la demo solo elimina la demo simulada de esta tienda', async () => {
    const a = api(TENANT_A.tenantId, GLOBAL);
    assert.equal((await a.call('DELETE', '/reports/segments/demo')).status, 200);
    assert.equal((await a.call('GET', '/reports/segments?source=demo')).body.status, 'sin_entrenar');
    assert.equal((await a.call('GET', '/reports/segments?source=real')).body.status, 'listo');
    assert.equal(existsSync(join(ROOT, 'salidas', 'web', 'real', TENANT_A.tenantId, 'resultado', 'resultado.json')), true);
  });
});
