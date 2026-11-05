import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Module from 'node:module';
import { beforeEach, describe, it } from 'node:test';
import ts from 'typescript';

// Lógica real de app_movil/src/utils/checkoutAttempts.ts, transpilada y ejecutada con almacenamiento y API
// simulados. No reemplaza una prueba en dispositivo: demuestra el protocolo, no el comportamiento del SO.
const source = readFileSync(join(__dirname, '..', '..', '..', '..', 'app_movil', 'src', 'utils', 'checkoutAttempts.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });

const httpError = (status: number, data: unknown = {}) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });

describe('App móvil: intentos durables', () => {
  let storage: Map<string, string>;
  let tenant: string;
  let api: { create: (payload: unknown, key: string) => Promise<any>; getAttempt: (key: string) => Promise<any> };
  let flow: any;
  const payload = { cartVersion: 3, items: [{ productId: 'p', quantity: 1, size: 'M' }] };

  beforeEach(() => {
    storage = new Map();
    tenant = 'tenant-a';
    api = { create: async () => ({ id: 'order-1', total: 100 }), getAttempt: async () => ({ status: 'IN_PROGRESS', orderId: null }) };
    const stubs: Record<string, unknown> = {
      './storage': { appStorage: { getItem: async (k: string) => storage.get(k) ?? null, setItem: async (k: string, v: string) => void storage.set(k, v) } },
      '../config/tenant': { getTenantId: async () => tenant },
      '../api/orders.api': { ordersApi: { create: (p: unknown, k: string) => api.create(p, k), getAttempt: (k: string) => api.getAttempt(k) } },
    };
    const mod = new Module('checkoutAttempts');
    mod.require = ((id: string) => stubs[id]) as never;
    (mod as any)._compile(outputText, 'checkoutAttempts.js');
    flow = mod.exports;
  });

  it('U01: el intento se guarda antes de enviar y un corte conserva la misma clave', async () => {
    const keys: string[] = [];
    api.create = async (_p, key) => {
      keys.push(key);
      throw Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
    };
    const attempt = await flow.createAttempt('user-1', payload);
    assert.equal((await flow.getOwnAttempts('user-1')).length, 1, 'persistido antes del envío');
    const result = await flow.submitAttempt(attempt);
    assert.equal(result.kind, 'uncertain');
    const [saved] = await flow.getOwnAttempts('user-1');
    assert.equal(saved.state, 'IN_DOUBT');

    // Cierre forzado y reapertura: 404 no autoriza otra compra, se reenvía con la misma clave
    api.getAttempt = async () => {
      throw httpError(404);
    };
    api.create = async (_p, key) => {
      keys.push(key);
      return { id: 'order-1', total: 100 };
    };
    saved.nextRetryAt = 0;
    storage.set([...storage.keys()][0], JSON.stringify([saved]));
    await flow.recoverAttempts('user-1');
    const [recovered] = await flow.getOwnAttempts('user-1');
    assert.equal(recovered.state, 'CONFIRMED');
    assert.equal(recovered.orderId, 'order-1');
    assert.equal(new Set(keys).size, 1, 'una sola clave en todos los envíos');
  });

  it('el servidor ya lo tenía: se enlaza sin reenviar', async () => {
    let creates = 0;
    api.create = async () => {
      creates += 1;
      throw httpError(503);
    };
    await flow.submitAttempt(await flow.createAttempt('user-1', payload));
    assert.equal(creates, 1);
    const [saved] = await flow.getOwnAttempts('user-1');
    saved.nextRetryAt = 0;
    storage.set([...storage.keys()][0], JSON.stringify([saved]));
    api.getAttempt = async () => ({ status: 'SUCCEEDED', orderId: 'order-9' });
    await flow.recoverAttempts('user-1');
    assert.equal(creates, 1);
    assert.equal((await flow.getOwnAttempts('user-1'))[0].orderId, 'order-9');
  });

  it('un rechazo del servidor es definitivo: se elimina y no se reintenta', async () => {
    api.create = async () => {
      throw httpError(409, { code: 'OUT_OF_STOCK', message: 'sin stock' });
    };
    const result = await flow.submitAttempt(await flow.createAttempt('user-1', payload));
    assert.deepEqual([result.kind, result.code], ['rejected', 'OUT_OF_STOCK']);
    assert.equal((await flow.getOwnAttempts('user-1')).length, 0);
  });

  it('ATTEMPT_IN_PROGRESS no es un rechazo', async () => {
    api.create = async () => {
      throw httpError(409, { code: 'ATTEMPT_IN_PROGRESS' });
    };
    assert.equal((await flow.submitAttempt(await flow.createAttempt('user-1', payload))).kind, 'uncertain');
  });

  it('U02/M01: otra cuenta u otra tienda no ven ni envían el intento, y no se borra', async () => {
    let creates = 0;
    api.create = async () => {
      creates += 1;
      throw httpError(500);
    };
    await flow.submitAttempt(await flow.createAttempt('user-1', payload));
    assert.equal(creates, 1);
    assert.equal((await flow.getOwnAttempts('user-2')).length, 0);
    await flow.recoverAttempts('user-2');
    tenant = 'tenant-b';
    assert.equal((await flow.getOwnAttempts('user-1')).length, 0);
    await flow.recoverAttempts('user-1');
    assert.equal(creates, 1);
    tenant = 'tenant-a';
    assert.equal((await flow.getOwnAttempts('user-1')).length, 1);
  });

  it('si no se puede guardar, createAttempt falla y no hay nada que enviar', async () => {
    const original = storage.set.bind(storage);
    storage.set = () => {
      throw new Error('disco lleno');
    };
    await assert.rejects(flow.createAttempt('user-1', payload));
    storage.set = original;
  });

  it('no guarda secretos en la cola', async () => {
    await flow.createAttempt('user-1', payload);
    const raw = [...storage.values()].join('');
    assert.equal(/secret|token|bearer|card/i.test(raw), false);
  });
});
