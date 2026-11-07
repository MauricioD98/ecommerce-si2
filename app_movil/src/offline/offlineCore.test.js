// Pruebas del núcleo sin conexión con SQLite REAL (node:sqlite, el mismo motor que expo-sqlite).
//   node --test src/offline/offlineCore.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const core = require('./offlineCore');

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// Mismo contrato que src/offline/database.ts (adaptador de expo-sqlite)
function sqlite() {
  const raw = new DatabaseSync(':memory:');
  return {
    raw,
    exec: async (sql) => raw.exec(sql),
    run: async (sql, params = []) => raw.prepare(sql).run(...params),
    get: async (sql, params = []) => raw.prepare(sql).get(...params) ?? null,
    all: async (sql, params = []) => raw.prepare(sql).all(...params),
  };
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload) => `${b64({ alg: 'HS256' })}.${b64(payload)}.firma`;
const tokenOf = (sub, tenantId, extra = {}) => jwt({ sub, tenantId, exp: Math.floor(Date.now() / 1000) + 3600, ...extra });

let ids = 0;
const setup = () => {
  const db = sqlite();
  const store = core.createOfflineStore({ db, newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` });
  return { db, store };
};
const user = (id, firstName, lastName = 'Pérez') => ({ id, email: `${id.slice(0, 4)}@demo.local`, firstName, lastName, role: { id: 'r', name: 'Cliente' } });

test('esquema: tablas versionadas y ninguna columna para secretos', async () => {
  const { db, store } = setup();
  await store.init();
  await store.init(); // idempotente
  assert.equal(db.raw.prepare('PRAGMA user_version').get().user_version, core.SCHEMA_VERSION);
  const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
  assert.deepEqual(tables, ['profile_change', 'profile_snapshot', 'read_cache']);
  for (const table of tables) {
    const cols = db.raw.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    assert.ok(!cols.some((c) => /pass|token|secret|card|cvc/i.test(c)), `${table}: ${cols}`);
  }
});

test('la copia del perfil guarda solo datos de perfil (nunca contraseña ni tokens)', async () => {
  const { db, store } = setup();
  await store.saveProfileSnapshot(T1, { ...user(A, 'Ana'), password: 'hash', accessToken: 'jwt', refreshToken: 'r', cardNumber: '4242' });
  const raw = db.raw.prepare('SELECT data FROM profile_snapshot').get().data;
  assert.doesNotMatch(raw, /hash|jwt|4242|password|Token|card/);
  const snap = await store.getProfileSnapshot(T1, A);
  assert.equal(snap.user.firstName, 'Ana');
});

test('editar sin conexión: pendiente con el valor esperado; repetir conserva el changeId; volver al original lo descarta', async () => {
  const { store } = setup();
  const server = { firstName: 'Ana', lastName: 'Pérez' };
  const first = await store.recordProfileEdit(T1, A, server, { firstName: '  Ana María ', lastName: 'Pérez' });
  assert.equal(first.status, 'pending');
  assert.deepEqual(first.changes, { firstName: 'Ana María' }, 'solo lo que cambió, recortado como el servidor');
  assert.deepEqual(first.expected, { firstName: ['Ana'] });

  const same = await store.recordProfileEdit(T1, A, server, { firstName: 'Ana María', lastName: 'Pérez' });
  assert.equal(same.changeId, first.changeId);

  const more = await store.recordProfileEdit(T1, A, server, { firstName: 'Ana María', lastName: 'Gómez' });
  assert.equal(more.changeId, first.changeId, 'todavía no se envió: mismo cambio');
  assert.deepEqual(more.expected, { firstName: ['Ana'], lastName: ['Pérez'] });

  assert.equal(await store.recordProfileEdit(T1, A, server, { firstName: 'Ana', lastName: 'Pérez' }), null);
  assert.equal(await store.getProfileChange(T1, A), null);
});

test('editar después de enviar: changeId nuevo y el valor enviado también se acepta en el servidor', async () => {
  const { store } = setup();
  const server = { firstName: 'Ana', lastName: 'Pérez' };
  const c = await store.recordProfileEdit(T1, A, server, { firstName: 'Beatriz' });
  await store.patchProfileChange(T1, A, c.changeId, { sent: true, status: 'pending' });
  const next = await store.recordProfileEdit(T1, A, server, { firstName: 'Carla' });
  assert.notEqual(next.changeId, c.changeId);
  assert.deepEqual(next.expected.firstName, ['Ana', 'Beatriz']);
});

test('aislamiento: cada (tienda, usuario) tiene su propio cambio', async () => {
  const { store } = setup();
  await store.recordProfileEdit(T1, A, { firstName: 'Ana' }, { firstName: 'A-T1' });
  await store.recordProfileEdit(T1, B, { firstName: 'Beto' }, { firstName: 'B-T1' });
  await store.recordProfileEdit(T2, A, { firstName: 'Ana' }, { firstName: 'A-T2' });
  assert.equal((await store.getProfileChange(T1, A)).changes.firstName, 'A-T1');
  assert.equal((await store.getProfileChange(T1, B)).changes.firstName, 'B-T1');
  assert.equal((await store.getProfileChange(T2, A)).changes.firstName, 'A-T2');
  assert.equal(await store.getProfileChange(T2, B), null);
  assert.deepEqual((await store.unsyncedUsers(T1)).sort(), [A, B]);
});

// ─── Sincronización ────────────────────────────────────────────────────────────────────────────

const sessionOf = (tenantId, userId, token = tokenOf(userId, tenantId)) => async () => ({ tenantId, userId, accessToken: token });

test('sincroniza: "sincronizando" durante el envío y "sincronizado" solo tras el 200 del servidor', async () => {
  const { store } = setup();
  const c = await store.recordProfileEdit(T1, A, { firstName: 'Ana' }, { firstName: 'Beatriz' });
  let seenDuring;
  let body;
  const outcome = await core.syncProfileOnce({
    store,
    getSession: sessionOf(T1, A),
    send: async (change) => {
      seenDuring = (await store.getProfileChange(T1, A)).status;
      body = { changeId: change.changeId, changes: change.changes, expected: change.expected };
      return { status: 200, data: user(A, 'Beatriz') };
    },
  });
  assert.equal(outcome, 'synced');
  assert.equal(seenDuring, 'syncing');
  assert.deepEqual(body, { changeId: c.changeId, changes: { firstName: 'Beatriz' }, expected: { firstName: ['Ana'] } });
  const after = await store.getProfileChange(T1, A);
  assert.equal(after.status, 'synced');
  assert.ok(after.syncedAt);
  assert.equal((await store.getProfileSnapshot(T1, A)).user.firstName, 'Beatriz');
  assert.equal(await core.syncProfileOnce({ store, getSession: sessionOf(T1, A), send: async () => assert.fail('nada que enviar') }), 'skipped');
});

test('sin respuesta (sin red): sigue pendiente con el mismo changeId; nunca se marca sincronizado', async () => {
  const { store } = setup();
  const c = await store.recordProfileEdit(T1, A, { firstName: 'Ana' }, { firstName: 'Beatriz' });
  const outcome = await core.syncProfileOnce({ store, getSession: sessionOf(T1, A), send: async () => { throw new Error('Network Error'); } });
  assert.equal(outcome, 'pending');
  const after = await store.getProfileChange(T1, A);
  assert.equal(after.status, 'pending');
  assert.equal(after.changeId, c.changeId);
  assert.equal(after.sent, true);
  assert.equal(after.lastError, 'network');
  // 5xx: igual
  assert.equal(await core.syncProfileOnce({ store, getSession: sessionOf(T1, A), send: async () => ({ status: 503, data: {} }) }), 'pending');
  // Respuesta 200 de OTRO usuario: no se da por confirmado
  assert.equal(await core.syncProfileOnce({ store, getSession: sessionOf(T1, A), send: async () => ({ status: 200, data: user(B, 'x') }) }), 'pending');
  assert.equal((await store.getProfileChange(T1, A)).status, 'pending');
});

test('nunca envía el cambio de A con la sesión de B ni con el token de otra tienda', async () => {
  const { store } = setup();
  await store.recordProfileEdit(T1, A, { firstName: 'Ana' }, { firstName: 'Beatriz' });
  const send = async () => assert.fail('no debe salir a la red');
  // El usuario de la sesión es A pero el token es de B
  assert.equal(await core.syncProfileOnce({ store, getSession: sessionOf(T1, A, tokenOf(B, T1)), send }), 'needs-login');
  // Token de A pero emitido por otra tienda
  await store.requeueProfileChange(T1, A, ['needs-login']);
  assert.equal(await core.syncProfileOnce({ store, getSession: sessionOf(T1, A, tokenOf(A, T2)), send }), 'needs-login');
  // Sesión de B: solo mira el cambio de B (no hay), el de A queda intacto
  await store.requeueProfileChange(T1, A, ['needs-login']);
  assert.equal(await core.syncProfileOnce({ store, getSession: sessionOf(T1, B), send }), 'skipped');
  assert.equal((await store.getProfileChange(T1, A)).status, 'pending');
  // Sin sesión
  assert.equal(await core.syncProfileOnce({ store, getSession: async () => ({ tenantId: T1, userId: null, accessToken: null }), send }), 'skipped');
});

test('sesión vencida: el cambio se conserva y espera a que la MISMA cuenta vuelva', async () => {
  const { store } = setup();
  const c = await store.recordProfileEdit(T1, A, { firstName: 'Ana' }, { firstName: 'Beatriz' });
  // 401 directo
  assert.equal(await core.syncProfileOnce({ store, getSession: sessionOf(T1, A), send: async () => ({ status: 401, data: {} }) }), 'needs-login');
  assert.equal((await store.getProfileChange(T1, A)).status, 'needs-login');
  // No se reintenta solo mientras espera sesión
  assert.equal(await core.syncProfileOnce({ store, getSession: sessionOf(T1, A), send: async () => assert.fail() }), 'skipped');
  // El cliente HTTP no pudo renovar y borró la sesión (el fallo llega sin respuesta)
  await store.requeueProfileChange(T1, A, ['needs-login']);
  const outcome = await core.syncProfileOnce({
    store,
    getSession: sessionOf(T1, A),
    send: async () => { throw new Error('Tu sesión ha expirado'); },
    sessionStillValid: async () => false,
  });
  assert.equal(outcome, 'needs-login');
  const kept = await store.getProfileChange(T1, A);
  assert.equal(kept.changeId, c.changeId);
  assert.deepEqual(kept.changes, { firstName: 'Beatriz' });
});

test('conflicto: 409 deja el cambio para revisar con el valor del servidor; nada se pisa', async () => {
  const { store } = setup();
  await store.recordProfileEdit(T1, A, { firstName: 'Ana', lastName: 'Pérez' }, { firstName: 'Beatriz', lastName: 'Gómez' });
  const current = user(A, 'Carla', 'Gómez'); // otro dispositivo puso Carla; el apellido coincide con el mío
  const outcome = await core.syncProfileOnce({
    store,
    getSession: sessionOf(T1, A),
    send: async () => ({ status: 409, data: { code: 'PROFILE_CONFLICT', current } }),
  });
  assert.equal(outcome, 'conflict');
  const c = await store.getProfileChange(T1, A);
  assert.equal(c.status, 'conflict');
  assert.deepEqual(c.conflict.fields, ['firstName'], 'el apellido ya está como lo quiero: no es conflicto');
  assert.equal(c.conflict.server.firstName, 'Carla');
  assert.equal((await store.getProfileSnapshot(T1, A)).user.firstName, 'Carla');
  // En conflicto no se reenvía solo
  assert.equal(await core.syncProfileOnce({ store, getSession: sessionOf(T1, A), send: async () => assert.fail() }), 'skipped');

  // "Usar mis cambios": changeId nuevo y ahora se espera lo que hay en el servidor
  const mine = await store.resolveProfileConflict(T1, A, 'mine');
  assert.notEqual(mine.changeId, c.changeId);
  assert.equal(mine.status, 'pending');
  assert.deepEqual(mine.changes, { firstName: 'Beatriz' });
  assert.deepEqual(mine.expected, { firstName: ['Carla'] });
});

test('conflicto: "conservar los del servidor" descarta solo los campos en conflicto', async () => {
  const { store } = setup();
  await store.recordProfileEdit(T1, A, { firstName: 'Ana', lastName: 'Pérez' }, { firstName: 'Beatriz', lastName: 'Gómez' });
  await core.syncProfileOnce({
    store,
    getSession: sessionOf(T1, A),
    send: async () => ({ status: 409, data: { code: 'PROFILE_CONFLICT', current: user(A, 'Carla', 'Pérez') } }),
  });
  const kept = await store.resolveProfileConflict(T1, A, 'server');
  assert.deepEqual(kept.changes, { lastName: 'Gómez' }, 'el apellido (sin conflicto) sigue pendiente');
  assert.deepEqual(kept.expected, { lastName: ['Pérez'] });
});

test('rechazo del servidor (400): error visible, no se reintenta solo; reintentar o descartar', async () => {
  const { store } = setup();
  await store.recordProfileEdit(T1, A, { firstName: 'Ana' }, { firstName: 'x'.repeat(61) });
  const outcome = await core.syncProfileOnce({
    store,
    getSession: sessionOf(T1, A),
    send: async () => ({ status: 400, data: { message: ['firstName must be shorter than or equal to 60 characters'] } }),
  });
  assert.equal(outcome, 'error');
  assert.match((await store.getProfileChange(T1, A)).lastError, /60 characters/);
  assert.equal(await core.syncProfileOnce({ store, getSession: sessionOf(T1, A), send: async () => assert.fail() }), 'skipped');
  assert.equal((await store.requeueProfileChange(T1, A, ['error'])).status, 'pending');
  await store.discardProfileChange(T1, A);
  assert.equal(await store.getProfileChange(T1, A), null);
});

test('un cambio en "sincronizando" al cerrar la app se reenvía con el mismo changeId', async () => {
  const { store } = setup();
  const c = await store.recordProfileEdit(T1, A, { firstName: 'Ana' }, { firstName: 'Beatriz' });
  await store.patchProfileChange(T1, A, c.changeId, { status: 'syncing', sent: true });
  let sentId;
  await core.syncProfileOnce({ store, getSession: sessionOf(T1, A), send: async (ch) => { sentId = ch.changeId; return { status: 200, data: user(A, 'Beatriz') }; } });
  assert.equal(sentId, c.changeId);
});

test('una edición durante el envío no se pierde: el 200 del cambio anterior no la marca sincronizada', async () => {
  const { store } = setup();
  await store.recordProfileEdit(T1, A, { firstName: 'Ana' }, { firstName: 'Beatriz' });
  await core.syncProfileOnce({
    store,
    getSession: sessionOf(T1, A),
    send: async () => {
      await store.recordProfileEdit(T1, A, { firstName: 'Ana' }, { firstName: 'Carla' });
      return { status: 200, data: user(A, 'Beatriz') };
    },
  });
  const c = await store.getProfileChange(T1, A);
  assert.equal(c.status, 'pending');
  assert.equal(c.changes.firstName, 'Carla');
  assert.deepEqual(c.expected.firstName, ['Ana', 'Beatriz']);
});

// ─── Copias de lectura y cierre de sesión ──────────────────────────────────────────────────────

test('qué GET se guardan: catálogo público; carrito y pedidos privados; nada de intentos, pagos ni perfil', () => {
  assert.equal(core.readScopeOf('/products'), 'public');
  assert.equal(core.readScopeOf('/products/abc?branchId=1'), 'public');
  assert.equal(core.readScopeOf('/categories'), 'public');
  assert.equal(core.readScopeOf('/branches'), 'public');
  assert.equal(core.readScopeOf('/cart'), 'private');
  assert.equal(core.readScopeOf('/orders'), 'private');
  assert.equal(core.readScopeOf('/orders/123'), 'private');
  assert.equal(core.readScopeOf('/payments/order/123'), 'private');
  for (const p of ['/orders/attempts/k', '/users/me', '/payments/qr/status/1', '/store/payment-options', '/payments', '/auth/mobile/challenge']) {
    assert.equal(core.readScopeOf(p), null, p);
  }
  assert.equal(core.readCacheKey('/products', { page: 1, categoryId: 'c', search: '' }, 'es'), 'es|/products?categoryId=c&page=1');
  assert.notEqual(core.readCacheKey('/products', {}, 'es'), core.readCacheKey('/products', {}, 'en'));
});

test('copias por tienda y usuario; cerrar sesión borra lo privado de esa cuenta y conserva su cambio pendiente', async () => {
  const { store } = setup();
  await store.saveRead(T1, null, 'k-cat', { products: [1] });
  await store.saveRead(T1, A, 'k-cart', { items: ['A'] });
  await store.saveRead(T1, B, 'k-cart', { items: ['B'] });
  await store.saveRead(T2, A, 'k-cart', { items: ['A-T2'] });
  await store.saveProfileSnapshot(T1, user(A, 'Ana'));
  await store.recordProfileEdit(T1, A, { firstName: 'Ana' }, { firstName: 'Beatriz' });

  assert.deepEqual((await store.getRead(T1, B, 'k-cart')).data, { items: ['B'] });
  assert.equal(await store.getRead(T2, B, 'k-cart'), null);

  await store.clearUserData(T1, A);
  assert.equal(await store.getRead(T1, A, 'k-cart'), null);
  assert.equal(await store.getProfileSnapshot(T1, A), null);
  assert.ok(await store.getRead(T1, B, 'k-cart'), 'la otra cuenta no se toca');
  assert.ok(await store.getRead(T2, A, 'k-cart'), 'la otra tienda no se toca');
  assert.ok(await store.getRead(T1, null, 'k-cat'), 'el catálogo público queda');
  assert.equal((await store.getProfileChange(T1, A)).status, 'pending', 'el cambio sin enviar se conserva');

  await store.clearPrivateData(T1);
  assert.equal(await store.getRead(T1, B, 'k-cart'), null);
  assert.ok(await store.getRead(T1, null, 'k-cat'));
});

test('applyPendingValues y tokens', () => {
  const u = user(A, 'Ana');
  assert.equal(core.applyPendingValues(u, { status: 'pending', changes: { firstName: 'Bea' } }).firstName, 'Bea');
  assert.equal(core.applyPendingValues(u, { status: 'synced', changes: { firstName: 'Bea' } }).firstName, 'Ana');
  assert.equal(core.tokenBelongsTo(tokenOf(A, T1), A, T1), true);
  assert.equal(core.tokenBelongsTo(tokenOf(A, T1), B, T1), false);
  assert.equal(core.tokenBelongsTo(jwt({ sub: A }), A, T1), false, 'sin tienda en el token no se puede afirmar');
  assert.equal(core.tokenBelongsTo('basura', A, T1), false);
  assert.equal(core.isTokenExpired(jwt({ exp: Math.floor(Date.now() / 1000) - 10 })), true);
  assert.equal(core.isTokenExpired(tokenOf(A, T1)), false);
  assert.equal(core.jwtPayload(jwt({ sub: A, name: 'Ñandú José' })).name, 'Ñandú José', 'UTF-8');
});
