import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Api, TENANT_A, TENANT_B, bootApp, createProduct, createUser, queryRows, seedTenant, type Fixture } from './support/world';
import { TenantResolutionCache } from '../../src/tenancy/tenant-resolution-cache.service';

// Pronóstico de ventas (IA/AS) por HTTP: plan, permisos, estados, aislamiento entre tiendas y separación
// demo/real. Ejecuta el Python REAL (IA/AS/.venv) sobre una copia del paquete en una carpeta temporal,
// así que no escribe nada en IA/AS/salidas. Sin el entorno virtual de IA/AS la suite se omite.
const REPO_AS = resolve(__dirname, '..', '..', '..', '..', 'IA', 'AS');
const PYTHON = join(REPO_AS, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const HAS_PYTHON = existsSync(PYTHON);
const ROOT = mkdtempSync(join(tmpdir(), 'forecast-acceptance-'));
if (HAS_PYTHON) cpSync(join(REPO_AS, 'pronostico_ventas'), join(ROOT, 'pronostico_ventas'), { recursive: true });
process.env.FORECAST_DIR = ROOT;
process.env.FORECAST_PYTHON = PYTHON;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Pronóstico de ventas: /reports/forecast', { skip: HAS_PYTHON ? false : 'Falta IA/AS/.venv' }, () => {
  let app: INestApplication;
  let base: string;
  let fxA: Fixture;
  let fxB: Fixture;

  // Token con rol y sucursal reales en el payload (como los emite AuthService)
  const token = (tenantId: string, permissions: string[], branchId: string | null = null, roleName = 'Gerente') =>
    app.get(JwtService, { strict: false }).sign(
      { sub: randomUUID(), email: 'f@test.local', role: { id: randomUUID(), name: roleName }, permissions, branchId, tenantId },
      { secret: process.env.JWT_SECRET, expiresIn: 3600 },
    );
  const api = (tenantId: string, permissions: string[], branchId: string | null = null) =>
    new Api(base, tenantId, token(tenantId, permissions, branchId));
  const GLOBAL = ['VIEW_REPORTS', 'ALL_BRANCHES'];
  const setPlan = async (tenantId: string, plan: string) => {
    await queryRows('UPDATE public.tenants SET plan=$2 WHERE id=$1', [tenantId, plan]);
    app.get(TenantResolutionCache, { strict: false }).invalidate(tenantId);
  };
  const waitDone = async (client: Api, source: 'real' | 'demo') => {
    for (let i = 0; i < 300; i++) {
      const res = await client.call('GET', `/reports/forecast?source=${source}`);
      if (res.body.status !== 'entrenando') return res;
      await sleep(1000);
    }
    throw new Error('El entrenamiento no terminó a tiempo');
  };

  before(async () => {
    app = await bootApp();
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    fxA = await seedTenant(TENANT_A.schemaName);
    fxB = await seedTenant(TENANT_B.schemaName);
  });
  after(async () => {
    await setPlan(TENANT_A.tenantId, 'free').catch(() => undefined);
    await setPlan(TENANT_B.tenantId, 'free').catch(() => undefined);
    await app?.close();
    rmSync(ROOT, { recursive: true, force: true });
  });

  it('exige un plan con aiReports y el permiso VIEW_REPORTS', async () => {
    await setPlan(TENANT_A.tenantId, 'starter');
    assert.equal((await api(TENANT_A.tenantId, GLOBAL).call('GET', '/reports/forecast?source=demo')).status, 403);
    await setPlan(TENANT_A.tenantId, 'pro');
    await setPlan(TENANT_B.tenantId, 'pro');
    assert.equal((await api(TENANT_A.tenantId, ['ALL_BRANCHES']).call('GET', '/reports/forecast?source=demo')).status, 403);
    assert.equal((await new Api(base, TENANT_A.tenantId).call('GET', '/reports/forecast?source=demo')).status, 401);
  });

  it('valida el origen y no entrena al consultar', async () => {
    const a = api(TENANT_A.tenantId, GLOBAL);
    assert.equal((await a.call('GET', '/reports/forecast?source=../real')).status, 400);
    const res = await a.call('GET', '/reports/forecast?source=demo');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'sin_entrenar');
    assert.equal(res.body.simulated, true);
    assert.equal(res.body.canTrain, true);
    assert.deepEqual(res.body.forecast, []);
    assert.equal(existsSync(join(ROOT, 'salidas', 'web', 'demo', TENANT_A.tenantId)), false);
  });

  it('entrenar requiere alcance global (mensaje traducido)', async () => {
    const branchUser = api(TENANT_A.tenantId, ['VIEW_REPORTS'], fxA.branchA);
    const es = await branchUser.call('POST', '/reports/forecast/train', { body: { source: 'demo' } });
    assert.equal(es.status, 403);
    assert.match(es.body.message, /todas las sucursales/);
    const en = await branchUser.call('POST', '/reports/forecast/train', { body: { source: 'demo' }, headers: { 'accept-language': 'en' } });
    assert.match(en.body.message, /all branches/);
  });

  it('demo: entrena una vez, rechaza una ejecución duplicada y queda "listo" con 80/20 por semanas', async () => {
    const a = api(TENANT_A.tenantId, GLOBAL);
    const start = await a.call('POST', '/reports/forecast/train', { body: { source: 'demo' } });
    assert.equal(start.status, 202);
    assert.equal(start.body.status, 'entrenando');
    const dup = await a.call('POST', '/reports/forecast/train', { body: { source: 'real' } });
    assert.equal(dup.status, 409);

    const done = await waitDone(a, 'demo');
    assert.equal(done.body.status, 'listo', JSON.stringify(done.body).slice(0, 300));
    const r = done.body.result;
    assert.equal(r.origen, 'simulado');
    assert.equal(r.tienda_id, TENANT_A.tenantId);
    assert.ok(r.division.semanas_objetivo >= 100);
    assert.equal(r.division.entrenamiento.semanas, Math.floor((r.division.semanas_objetivo * 8) / 10));
    assert.ok(new Date(r.division.entrenamiento.hasta) < new Date(r.division.prueba.desde));
    assert.equal(typeof r.metricas_prueba.mae_modelo, 'number');
    assert.equal(typeof r.metricas_prueba.mae_linea_base_promedio_4_semanas, 'number');
    assert.deepEqual(r.periodo_pronosticado, { desde: '2026-11-02', hasta: '2026-11-08' });
    assert.ok(done.body.forecast.some((f: { metodo: string }) => f.metodo === 'modelo'));
    assert.ok(done.body.forecast.some((f: { metodo: string }) => f.metodo === 'alternativa_promedio'));
  });

  it('otra tienda no ve el modelo ni el pronóstico, aunque cambie identificadores', async () => {
    const b = api(TENANT_B.tenantId, GLOBAL);
    const res = await b.call('GET', '/reports/forecast?source=demo');
    assert.equal(res.body.status, 'sin_entrenar');
    assert.equal(res.body.result, null);
    assert.deepEqual(res.body.forecast, []);
    // Token de A enviado a la tienda B: rechazado por JwtStrategy
    const crossed = new Api(base, TENANT_B.tenantId, token(TENANT_A.tenantId, GLOBAL));
    assert.equal((await crossed.call('GET', '/reports/forecast?source=demo')).status, 401);
    // Parámetros extra con el id de la otra tienda no eligen carpeta
    const extra = await b.call('GET', `/reports/forecast?source=demo&tenantId=${TENANT_A.tenantId}&branchId=${fxA.branchA}`);
    assert.equal(extra.body.result, null);
    // Un resultado de A copiado por error en la carpeta de B no se devuelve
    const dirB = join(ROOT, 'salidas', 'web', 'demo', TENANT_B.tenantId);
    mkdirSync(dirB, { recursive: true });
    cpSync(join(ROOT, 'salidas', 'web', 'demo', TENANT_A.tenantId, 'resultado'), join(dirB, 'resultado'), { recursive: true });
    const copied = await b.call('GET', '/reports/forecast?source=demo');
    assert.equal(copied.body.result, null);
    assert.deepEqual(copied.body.forecast, []);
    rmSync(dirB, { recursive: true, force: true });
  });

  it('usuario de sucursal: solo su sucursal y no puede pedir otra', async () => {
    const branchUser = api(TENANT_A.tenantId, ['VIEW_REPORTS'], fxA.branchA);
    assert.equal((await branchUser.call('GET', `/reports/forecast?source=demo&branchId=${fxA.branchB}`)).status, 403);
    const res = await branchUser.call('GET', '/reports/forecast?source=demo');
    assert.equal(res.body.canTrain, false);
    for (const row of res.body.forecast) assert.ok(row.sucursal_id === null || row.sucursal_id === fxA.branchA);
  });

  it('real: tienda con poco historial -> datos_insuficientes, separado de la demo', async () => {
    const schema = `"${TENANT_A.schemaName}"`;
    const productId = await createProduct(TENANT_A.schemaName, fxA, { [fxA.branchA]: { M: 50 } });
    const userId = await createUser(TENANT_A.schemaName, fxA);
    const lines: [string, string, number][] = [
      ['ENTREGADO', '2026-10-06T15:00:00Z', 2],
      ['CANCELADO', '2026-10-07T15:00:00Z', 5],
      ['ENTREGADO', '2026-10-14T15:00:00Z', 1],
    ];
    for (const [status, at, qty] of lines) {
      const orderId = randomUUID();
      await queryRows(
        `INSERT INTO ${schema}.orders (id,"orderNumber",status,"totalAmount","userId","branchId","createdAt","updatedAt") VALUES ($1,$2,$3,100,$4,$5,$6,now())`,
        [orderId, `ord-${orderId}`, status, userId, fxA.branchA, at],
      );
      await queryRows(
        `INSERT INTO ${schema}.order_items (id,quantity,price,size,"productId","orderId","updatedAt") VALUES ($1,$2,50,'M',$3,$4,now())`,
        [randomUUID(), qty, productId, orderId],
      );
    }
    const a = api(TENANT_A.tenantId, GLOBAL);
    assert.equal((await a.call('POST', '/reports/forecast/train', { body: { source: 'real' } })).status, 202);
    const done = await waitDone(a, 'real');
    assert.equal(done.body.status, 'datos_insuficientes');
    assert.equal(done.body.simulated, false);
    assert.equal(done.body.result.origen, 'real');
    assert.equal(done.body.result.datos.unidades_validas, 3); // el cancelado no cuenta
    assert.ok(done.body.forecast.every((f: { metodo: string }) => f.metodo !== 'modelo'));
    // La demo sigue intacta y marcada como simulada
    const demo = await a.call('GET', '/reports/forecast?source=demo');
    assert.equal(demo.body.status, 'listo');
    assert.equal(demo.body.result.origen, 'simulado');
  });

  it('borrar la demo solo elimina la demo simulada de esta tienda', async () => {
    const branchUser = api(TENANT_A.tenantId, ['VIEW_REPORTS'], fxA.branchA);
    assert.equal((await branchUser.call('DELETE', '/reports/forecast/demo')).status, 403);
    const a = api(TENANT_A.tenantId, GLOBAL);
    assert.equal((await a.call('DELETE', '/reports/forecast/demo')).status, 200);
    assert.equal((await a.call('GET', '/reports/forecast?source=demo')).body.status, 'sin_entrenar');
    assert.equal((await a.call('GET', '/reports/forecast?source=real')).body.status, 'datos_insuficientes');
    assert.equal(existsSync(join(ROOT, 'salidas', 'web', 'real', TENANT_A.tenantId, 'resultado', 'resultado.json')), true);
  });
});
