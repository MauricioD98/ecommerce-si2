import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { TENANT_A, apiFor, bootApp, createUser, queryRows, seedTenant, type Api, type Fixture } from './support/world';

// Perfil sin conexión de la app móvil (app_movil/src/offline/offlineCore.js): el MISMO código que corre en el
// teléfono, con SQLite real (node:sqlite, mismo motor que expo-sqlite) y la API real con PostgreSQL. Solo cambia
// el transporte: fetch en vez de axios.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = require(join(process.cwd(), '..', 'app_movil', 'src', 'offline', 'offlineCore.js'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite');

const schema = TENANT_A.schemaName;
const tenant = TENANT_A.tenantId;

function deviceStore() {
  const raw = new DatabaseSync(':memory:');
  const db = {
    exec: async (sql: string) => raw.exec(sql),
    run: async (sql: string, params: unknown[] = []) => raw.prepare(sql).run(...params),
    get: async (sql: string, params: unknown[] = []) => raw.prepare(sql).get(...params) ?? null,
    all: async (sql: string, params: unknown[] = []) => raw.prepare(sql).all(...params),
  };
  return core.createOfflineStore({ db });
}

describe('App móvil: perfil editado sin conexión → PATCH /users/me/sync', () => {
  let app: INestApplication;
  let fx: Fixture;

  const userRow = async (id: string) => (await queryRows(`SELECT "firstName","lastName" FROM "${schema}".users WHERE id=$1`, [id]))[0];
  const receipts = async (userId: string) => (await queryRows(`SELECT 1 FROM "${schema}".profile_sync_receipts WHERE "userId"=$1`, [userId])).length;
  const setName = (id: string, firstName: string) => queryRows(`UPDATE "${schema}".users SET "firstName"=$2, "updatedAt"=now() WHERE id=$1`, [id, firstName]);

  // Transporte del teléfono: el token y la tienda de la sesión activa
  let requests = 0;
  const send = (api: Api, { loseResponse = false } = {}) => async (change: any) => {
    requests += 1;
    const res = await api.call('PATCH', '/users/me/sync', {
      body: { changeId: change.changeId, changes: change.changes, expected: change.expected },
    });
    if (loseResponse) throw new Error('Network Error (la respuesta se perdió)');
    return { status: res.status, data: res.body };
  };
  const session = (api: Api, userId: string) => async () => ({ tenantId: tenant, userId, accessToken: api.token ?? null });

  const newUser = async (firstName = 'Ana', lastName = 'Pérez') => {
    const id = await createUser(schema, fx);
    await queryRows(`UPDATE "${schema}".users SET "firstName"=$2, "lastName"=$3 WHERE id=$1`, [id, firstName, lastName]);
    return { id, api: await apiFor(app, tenant, id) };
  };

  before(async () => {
    app = await bootApp();
    fx = await seedTenant(schema);
  });
  after(async () => {
    await app?.close();
  });

  it('M01: el cambio guardado en el teléfono se aplica al volver la conexión y queda "sincronizado"', async () => {
    const { id, api } = await newUser();
    const store = deviceStore();
    await store.saveProfileSnapshot(tenant, { id, firstName: 'Ana', lastName: 'Pérez' });
    const change = await store.recordProfileEdit(tenant, id, { firstName: 'Ana', lastName: 'Pérez' }, { firstName: ' Ana María ', lastName: 'Pérez' });
    assert.equal(change.status, 'pending');
    assert.equal((await userRow(id)).firstName, 'Ana', 'sin conexión no se tocó el servidor');

    const outcome = await core.syncProfileOnce({ store, getSession: session(api, id), send: send(api) });
    assert.equal(outcome, 'synced');
    assert.equal((await userRow(id)).firstName, 'Ana María');
    assert.equal((await store.getProfileChange(tenant, id)).status, 'synced');
    assert.equal((await store.getProfileSnapshot(tenant, id)).user.firstName, 'Ana María');
    assert.equal(await receipts(id), 1);
  });

  it('M02: respuesta perdida: el reintento con el mismo changeId no escribe dos veces', async () => {
    const { id, api } = await newUser();
    const store = deviceStore();
    await store.recordProfileEdit(tenant, id, { firstName: 'Ana' }, { firstName: 'Beatriz' });

    assert.equal(await core.syncProfileOnce({ store, getSession: session(api, id), send: send(api, { loseResponse: true }) }), 'pending');
    assert.equal((await userRow(id)).firstName, 'Beatriz', 'el servidor sí lo aplicó');
    assert.equal((await store.getProfileChange(tenant, id)).status, 'pending', 'sin respuesta no se marca sincronizado');

    // Otro dispositivo cambia el nombre antes del reintento: el reintento tardío NO lo pisa
    await setName(id, 'Carla');
    assert.equal(await core.syncProfileOnce({ store, getSession: session(api, id), send: send(api) }), 'synced');
    assert.equal((await userRow(id)).firstName, 'Carla');
    assert.equal(await receipts(id), 1);
  });

  it('M03: conflicto con otro dispositivo: nada se sobrescribe hasta que el usuario decide', async () => {
    const { id, api } = await newUser('Ana', 'Pérez');
    const store = deviceStore();
    await store.recordProfileEdit(tenant, id, { firstName: 'Ana', lastName: 'Pérez' }, { firstName: 'Beatriz', lastName: 'Gómez' });
    await setName(id, 'Carla'); // mientras el teléfono estaba sin conexión

    assert.equal(await core.syncProfileOnce({ store, getSession: session(api, id), send: send(api) }), 'conflict');
    assert.deepEqual(await userRow(id), { firstName: 'Carla', lastName: 'Pérez' }, 'el 409 no escribió nada');
    const conflict = await store.getProfileChange(tenant, id);
    assert.deepEqual(conflict.conflict.fields, ['firstName']);
    assert.equal(conflict.conflict.server.firstName, 'Carla');

    await store.resolveProfileConflict(tenant, id, 'mine');
    assert.equal(await core.syncProfileOnce({ store, getSession: session(api, id), send: send(api) }), 'synced');
    assert.deepEqual(await userRow(id), { firstName: 'Beatriz', lastName: 'Gómez' });
  });

  it('M04: el cambio de una cuenta jamás sale con la sesión de otra; queda guardado para su dueño', async () => {
    const a = await newUser('Ana');
    const b = await newUser('Beto');
    const store = deviceStore();
    await store.recordProfileEdit(tenant, a.id, { firstName: 'Ana' }, { firstName: 'Ana desde el teléfono' });

    const before = requests;
    // Inicia sesión B en el mismo teléfono: solo mira lo suyo
    assert.equal(await core.syncProfileOnce({ store, getSession: session(b.api, b.id), send: send(b.api) }), 'skipped');
    // Estado corrupto: usuario A en pantalla con el token de B → no se envía
    assert.equal(await core.syncProfileOnce({ store, getSession: async () => ({ tenantId: tenant, userId: a.id, accessToken: b.api.token }), send: send(b.api) }), 'needs-login');
    assert.equal(requests, before, 'ninguna petición salió');
    assert.equal((await userRow(a.id)).firstName, 'Ana');
    assert.equal((await userRow(b.id)).firstName, 'Beto');

    // Vuelve A: se reencola y se envía con SU sesión
    await store.requeueProfileChange(tenant, a.id, ['needs-login']);
    assert.equal(await core.syncProfileOnce({ store, getSession: session(a.api, a.id), send: send(a.api) }), 'synced');
    assert.equal((await userRow(a.id)).firstName, 'Ana desde el teléfono');
  });

  it('M05: sesión rechazada por el servidor (401): el cambio se conserva y pide iniciar sesión', async () => {
    const { id, api } = await newUser();
    const store = deviceStore();
    await store.recordProfileEdit(tenant, id, { firstName: 'Ana' }, { firstName: 'Beatriz' });
    // Token con los claims correctos pero firma inválida (como una sesión revocada o de otro servidor)
    const [h, p] = (api.token as string).split('.');
    const forged = api.as(`${h}.${p}.firma-invalida`);
    assert.equal(await core.syncProfileOnce({ store, getSession: session(forged, id), send: send(forged) }), 'needs-login');
    const kept = await store.getProfileChange(tenant, id);
    assert.equal(kept.status, 'needs-login');
    assert.deepEqual(kept.changes, { firstName: 'Beatriz' });
    assert.equal((await userRow(id)).firstName, 'Ana');
  });

  it('M06: el servidor aplica sus reglas: nombre vacío o demasiado largo se rechaza y queda en "error"', async () => {
    const { id, api } = await newUser();
    const store = deviceStore();
    await store.recordProfileEdit(tenant, id, { firstName: 'Ana' }, { firstName: 'x'.repeat(61) });
    assert.equal(await core.syncProfileOnce({ store, getSession: session(api, id), send: send(api) }), 'error');
    const failed = await store.getProfileChange(tenant, id);
    assert.ok(failed.lastError, 'mensaje del servidor visible');
    assert.equal((await userRow(id)).firstName, 'Ana');
  });
});
