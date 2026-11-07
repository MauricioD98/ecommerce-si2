import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { TENANT_A, TENANT_B, apiFor, bootApp, createUser, queryRows, seedTenant, type Api, type Fixture } from './support/world';

// PATCH /users/me/sync: cambios de perfil hechos sin conexión en la PWA. Escritura condicionada a lo que el
// dispositivo leyó, con recibo por changeId para que los reintentos sean idempotentes.
const schema = TENANT_A.schemaName;
const tenant = TENANT_A.tenantId;

describe('Perfil sin conexión: PATCH /users/me/sync', () => {
  let app: INestApplication;
  let fx: Fixture;

  const userRow = async (id: string, s = schema) =>
    (await queryRows(`SELECT "firstName","lastName",phone,"preferredBranchId",email,"updatedAt" FROM "${s}".users WHERE id=$1`, [id]))[0];
  const receipts = async (changeId: string, s = schema) =>
    (await queryRows(`SELECT * FROM "${s}".profile_sync_receipts WHERE "changeId"=$1`, [changeId])).length;
  const setName = (id: string, firstName: string | null, s = schema) =>
    queryRows(`UPDATE "${s}".users SET "firstName"=$2, "updatedAt"=now() WHERE id=$1`, [id, firstName]);

  const sync = (api: Api, body: unknown) => api.call('PATCH', '/users/me/sync', { body });

  before(async () => {
    app = await bootApp();
    fx = await seedTenant(schema);
  });
  after(async () => {
    await app?.close();
  });

  it('S01: aplica el cambio si el servidor sigue como lo leyó el dispositivo, y deja recibo', async () => {
    const userId = await createUser(schema, fx);
    await setName(userId, 'Ana');
    const api = await apiFor(app, tenant, userId);
    const changeId = randomUUID();
    const res = await sync(api, {
      changeId,
      changes: { firstName: '  Ana María ', phone: '+591 70000001', preferredBranchId: fx.branchA },
      expected: { firstName: ['Ana'], phone: [null], preferredBranchId: [null] },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.id, userId);
    assert.equal(res.body.firstName, 'Ana María', 'mismas reglas de recorte que PATCH /users/me');
    const row = await userRow(userId);
    assert.equal(row.firstName, 'Ana María');
    assert.equal(row.phone, '+591 70000001');
    assert.equal(row.preferredBranchId, fx.branchA);
    assert.equal(await receipts(changeId), 1);
    assert.equal('password' in res.body, false);
  });

  it('S02: reintento del mismo changeId: confirma sin volver a escribir, aunque otro dispositivo haya restaurado el valor', async () => {
    const userId = await createUser(schema, fx);
    await setName(userId, 'Ana');
    const api = await apiFor(app, tenant, userId);
    const body = { changeId: randomUUID(), changes: { firstName: 'Beatriz' }, expected: { firstName: ['Ana'] } };
    assert.equal((await sync(api, body)).status, 200);
    const afterFirst = await userRow(userId);

    // Respuesta perdida: el cliente reenvía igual. No hay segunda escritura
    const retry = await sync(api, body);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.firstName, 'Beatriz');
    assert.equal((await userRow(userId)).updatedAt.getTime(), afterFirst.updatedAt.getTime(), 'sin segunda escritura');

    // ABA: otro dispositivo vuelve a "Ana". El reintento tardío NO lo pisa
    await setName(userId, 'Ana');
    const late = await sync(api, body);
    assert.equal(late.status, 200);
    assert.equal(late.body.firstName, 'Ana', 'devuelve lo que hay, no reaplica');
    assert.equal((await userRow(userId)).firstName, 'Ana');
    assert.equal(await receipts(body.changeId), 1);
  });

  it('S03: conflicto si el dato cambió en el servidor: 409 con el perfil actual y nada escrito', async () => {
    const userId = await createUser(schema, fx);
    await setName(userId, 'Ana');
    await queryRows(`UPDATE "${schema}".users SET phone='+591 71111111' WHERE id=$1`, [userId]);
    const api = await apiFor(app, tenant, userId);
    // Otro dispositivo cambió el nombre mientras este estaba offline
    await setName(userId, 'Carla');
    const changeId = randomUUID();
    const res = await sync(api, {
      changeId,
      changes: { firstName: 'Beatriz', phone: '+591 72222222' },
      expected: { firstName: ['Ana'], phone: ['+591 71111111'] },
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'PROFILE_CONFLICT');
    assert.equal(res.body.current.id, userId);
    assert.equal(res.body.current.firstName, 'Carla');
    const row = await userRow(userId);
    assert.equal(row.firstName, 'Carla', 'no se sobrescribe la edición del otro dispositivo');
    assert.equal(row.phone, '+591 71111111', 'todo o nada: tampoco se aplica el campo sin conflicto');
    assert.equal(await receipts(changeId), 0);
  });

  it('S04: no es conflicto si otro campo cambió, ni si el servidor ya tiene el valor nuevo', async () => {
    const userId = await createUser(schema, fx);
    await setName(userId, 'Ana');
    const api = await apiFor(app, tenant, userId);
    // Otro dispositivo cambió el apellido (que este no toca)
    await queryRows(`UPDATE "${schema}".users SET "lastName"='Pérez' WHERE id=$1`, [userId]);
    const first = await sync(api, { changeId: randomUUID(), changes: { phone: '+591 73333333' }, expected: { phone: [null] } });
    assert.equal(first.status, 200);
    assert.equal(first.body.lastName, 'Pérez');

    // Otro dispositivo ya puso el mismo nombre que este quiere: se acepta
    await setName(userId, 'Daniela');
    const same = await sync(api, { changeId: randomUUID(), changes: { firstName: 'Daniela' }, expected: { firstName: ['Ana'] } });
    assert.equal(same.status, 200);
  });

  it('S05: reglas del servidor: sin valor esperado no escribe, el correo no se cambia, el nombre no se vacía, sucursal inactiva', async () => {
    const userId = await createUser(schema, fx);
    await setName(userId, 'Ana');
    const api = await apiFor(app, tenant, userId);
    const before = await userRow(userId);

    const blind = await sync(api, { changeId: randomUUID(), changes: { firstName: 'X' }, expected: {} });
    assert.equal(blind.status, 400, 'sobrescritura ciega rechazada');

    const email = await sync(api, {
      changeId: randomUUID(),
      changes: { email: 'otra@test.local', lastName: 'Ruiz' },
      expected: { lastName: [null] },
    });
    assert.equal(email.status, 200);
    assert.equal((await userRow(userId)).email, before.email, 'el correo no viaja por este endpoint');

    const noName = await sync(api, { changeId: randomUUID(), changes: { firstName: '   ' }, expected: { firstName: ['Ana'] } });
    assert.equal(noName.status, 400);

    const phone = await sync(api, { changeId: randomUUID(), changes: { phone: 'abc' }, expected: { phone: [null] } });
    assert.equal(phone.status, 400);

    await queryRows(`UPDATE "${schema}".branches SET "isActive"=false WHERE id=$1`, [fx.branchB]);
    const changeId = randomUUID();
    const branch = await sync(api, { changeId, changes: { preferredBranchId: fx.branchB }, expected: { preferredBranchId: [null] } });
    assert.equal(branch.status, 400);
    assert.equal(await receipts(changeId), 0, 'rechazado = no aplicado: un reintento corregido puede usar otro id');
    await queryRows(`UPDATE "${schema}".branches SET "isActive"=true WHERE id=$1`, [fx.branchB]);
    assert.equal((await userRow(userId)).firstName, 'Ana');
  });

  it('S06: aislamiento: sin sesión 401, el changeId de otra cuenta no sirve, el token de una tienda no vale en otra', async () => {
    const [userA, userB] = [await createUser(schema, fx), await createUser(schema, fx)];
    await setName(userA, 'Ana');
    await setName(userB, 'Berta');
    const apiA = await apiFor(app, tenant, userA);
    const apiB = await apiFor(app, tenant, userB);

    const anonymous = new (apiA.constructor as typeof Api)(apiA.baseUrl, tenant);
    assert.equal((await sync(anonymous, { changeId: randomUUID(), changes: { firstName: 'X' }, expected: { firstName: ['Ana'] } })).status, 401);

    const changeId = randomUUID();
    assert.equal((await sync(apiA, { changeId, changes: { firstName: 'Alicia' }, expected: { firstName: ['Ana'] } })).status, 200);
    const reused = await sync(apiB, { changeId, changes: { firstName: 'Bea' }, expected: { firstName: ['Berta'] } });
    assert.equal(reused.status, 409);
    assert.equal(reused.body.current, undefined, 'no revela el perfil de la otra cuenta');
    assert.equal((await userRow(userB)).firstName, 'Berta');
    assert.equal((await userRow(userA)).firstName, 'Alicia');

    // Token de la tienda A presentado en la tienda B
    const fxB = await seedTenant(TENANT_B.schemaName);
    const userInB = await createUser(TENANT_B.schemaName, fxB);
    const crossed = apiA.as(apiA.token!, TENANT_B.tenantId);
    const res = await sync(crossed, { changeId: randomUUID(), changes: { firstName: 'Z' }, expected: { firstName: [null] } });
    assert.equal(res.status, 401);
    assert.equal((await userRow(userInB, TENANT_B.schemaName)).firstName, null);
  });

  it('S07: el mismo cambio enviado dos veces a la vez se aplica una sola vez', async () => {
    const userId = await createUser(schema, fx);
    await setName(userId, 'Ana');
    const api = await apiFor(app, tenant, userId);
    const body = { changeId: randomUUID(), changes: { firstName: 'Elena' }, expected: { firstName: ['Ana'] } };
    const results = await Promise.all([sync(api, body), sync(api, body), sync(api, body)]);
    assert.deepEqual(results.map((r) => r.status), [200, 200, 200], JSON.stringify(results.map((r) => r.body)));
    assert.equal(await receipts(body.changeId), 1);
    assert.equal((await userRow(userId)).firstName, 'Elena');
  });
});
