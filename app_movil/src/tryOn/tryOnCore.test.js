// Pruebas del probador en vivo con componentes SIMULADOS (cámara, API, SDK de Decart y reloj).
//   node --test src/tryOn/tryOnCore.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('./tryOnCore');

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const U1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const P1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const EXPECTED = { tenantId: T1, userId: U1, productId: P1 };
const SESSION = {
  sessionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  apiKey: 'ek_fake_client_token',
  expiresAt: '2026-11-08T00:00:30Z',
  model: 'lucy-2.5',
  maxSessionSeconds: 60,
  prompt: 'Change the outfit',
  garmentImage: 'data:image/png;base64,iVBORw0KGgo=',
  ...EXPECTED,
};

// Reloj manual: los temporizadores solo avanzan con clock.advance(ms)
function fakeClock() {
  let now = 0;
  let seq = 0;
  const jobs = new Map();
  const add = (fn, ms, every) => {
    const id = ++seq;
    jobs.set(id, { fn, at: now + ms, every });
    return id;
  };
  return {
    now: () => now,
    setTimeout: (fn, ms) => add(fn, ms, null),
    clearTimeout: (id) => jobs.delete(id),
    setInterval: (fn, ms) => add(fn, ms, ms),
    clearInterval: (id) => jobs.delete(id),
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...jobs.entries()].filter(([, j]) => j.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, job] = next;
        now = job.at;
        if (job.every) job.at += job.every;
        else jobs.delete(id);
        job.fn();
      }
      now = end;
    },
    pending: () => jobs.size,
  };
}

const flush = () => new Promise((r) => setImmediate(r));

// Escenario simulado configurable. log registra el orden de lo que se abre y se cierra.
function harness(overrides = {}) {
  const clock = fakeClock();
  const log = [];
  const states = [];
  let handlers = null;
  const camera = { id: 'cam', closed: false };
  const remote = { id: 'remote' };
  const client = { disconnected: 0, disconnect() { this.disconnected += 1; log.push('disconnect'); } };
  const deps = {
    requestCameraPermission: async () => 'granted',
    isOnline: async () => true,
    expected: async () => EXPECTED,
    openCamera: async () => {
      log.push('openCamera');
      return camera;
    },
    closeCamera: (s) => {
      s.closed = true;
      log.push('closeCamera');
    },
    requestSession: async () => {
      log.push('requestSession');
      return SESSION;
    },
    describeApiFailure: async (e) => e.failure ?? {},
    connect: async (stream, session, h) => {
      log.push(`connect:${session.model}`);
      handlers = h;
      return client;
    },
    endSession: async (id) => log.push(`end:${id}`),
    onChange: (s) => states.push(s),
    ...clock,
    ...overrides,
  };
  const ctl = core.createLiveTryOnController(deps);
  return { ctl, clock, log, states, camera, remote, client, h: () => handlers };
}

async function goLive(t) {
  await t.ctl.start();
  t.h().onRemoteStream(t.remote);
  t.h().onConnectionChange('connected');
  t.h().onConnectionChange('generating');
  await flush();
}

test('isSessionFor: solo una sesión lucy-2.5 de esta tienda, cuenta y prenda, con token de cliente', () => {
  assert.equal(core.isSessionFor(SESSION, EXPECTED), true);
  assert.equal(core.isSessionFor({ ...SESSION, tenantId: T2 }, EXPECTED), false, 'otra tienda');
  assert.equal(core.isSessionFor({ ...SESSION, userId: T2 }, EXPECTED), false, 'otra cuenta');
  assert.equal(core.isSessionFor({ ...SESSION, productId: T2 }, EXPECTED), false, 'otra prenda');
  assert.equal(core.isSessionFor({ ...SESSION, model: 'lucy-2.6' }, EXPECTED), false, 'otro modelo');
  assert.equal(core.isSessionFor({ ...SESSION, apiKey: 'dct_permanent' }, EXPECTED), false, 'nunca una clave permanente');
  assert.equal(core.isSessionFor({ ...SESSION, garmentImage: 'https://x/y.png' }, EXPECTED), false);
  assert.equal(core.isSessionFor({ ...SESSION, maxSessionSeconds: 5 }, EXPECTED), false);
});

test('garmentIssue: sin foto de referencia o inactiva no se puede probar', () => {
  assert.equal(core.garmentIssue({ imageUrl: '' }), 'no_image');
  assert.equal(core.garmentIssue({ imageUrl: 'https://x/y.jpg', isActive: false }), 'unavailable');
  assert.equal(core.garmentIssue({ imageUrl: 'https://x/y.jpg' }), null);
});

test('flujo completo: permiso → cámara → sesión → lucy-2.5; la cuenta regresiva empieza al generar', async () => {
  const t = harness();
  await t.ctl.start();
  assert.deepEqual(t.log, ['openCamera', 'requestSession', 'connect:lucy-2.5'], 'el token se pide con la cámara ya abierta');
  assert.equal(t.ctl.getState().phase, 'connecting');
  assert.equal(t.ctl.getState().remoteStream, null, 'la cámara normal nunca se presenta como resultado');

  t.h().onRemoteStream(t.remote);
  t.h().onConnectionChange('generating');
  let s = t.ctl.getState();
  assert.equal(s.phase, 'live');
  assert.equal(s.remoteStream, t.remote);
  assert.equal(s.secondsLeft, 60);

  t.clock.advance(10_000);
  assert.equal(t.ctl.getState().secondsLeft, 50);
  t.h().onGenerationTick(10);
  assert.equal(t.ctl.getState().billedSeconds, 10);
});

test('Finalizar: cierra la sesión de Decart, apaga la cámara y avisa al backend una sola vez', async () => {
  const t = harness();
  await goLive(t);
  t.ctl.stop('user');
  t.ctl.stop('user');
  const s = t.ctl.getState();
  assert.equal(s.phase, 'ended');
  assert.equal(s.endReason, 'user');
  assert.equal(t.camera.closed, true);
  assert.equal(t.client.disconnected, 1);
  assert.equal(t.log.filter((l) => l.startsWith('end:')).length, 1);
  assert.equal(t.clock.pending(), 0, 'sin temporizadores colgados');
});

test('límite de duración: corte local a los maxSessionSeconds (respaldo del corte de Decart)', async () => {
  const t = harness();
  await goLive(t);
  t.clock.advance(59_000);
  assert.equal(t.ctl.getState().phase, 'live');
  t.clock.advance(1_000);
  assert.equal(t.ctl.getState().phase, 'ended');
  assert.equal(t.ctl.getState().endReason, 'limit');
  assert.equal(t.camera.closed, true);
});

test('Decart termina la sesión: session_limit = fin normal; créditos o moderación = error', async () => {
  const a = harness();
  await goLive(a);
  a.h().onSessionEnded('session_limit');
  assert.equal(a.ctl.getState().endReason, 'limit');
  assert.equal(a.camera.closed, true);

  const b = harness();
  await goLive(b);
  b.h().onSessionEnded('insufficient_credits');
  assert.deepEqual(b.ctl.getState().error, { kind: 'provider_credits', retryable: false });
  assert.equal(b.camera.closed, true);
});

test('corte de Decart por duración (error real "Session duration limit reached") = fin normal por límite', async () => {
  const t = harness();
  await goLive(t);
  t.h().onError({ code: 'WEBRTC_SERVER_ERROR', message: 'Session duration limit reached' });
  assert.equal(t.ctl.getState().phase, 'ended');
  assert.equal(t.ctl.getState().endReason, 'limit');
  assert.equal(t.ctl.getState().error, null);
  assert.equal(t.camera.closed, true);
  assert.equal(core.isDurationLimitError({ code: 'WEBRTC_SERVER_ERROR', message: 'boom' }), false);
});

test('segundo plano, sin red y salir de la pantalla cierran cámara y sesión', async () => {
  for (const reason of ['background', 'offline']) {
    const t = harness();
    await goLive(t);
    t.ctl.stop(reason);
    assert.equal(t.ctl.getState().phase, 'ended');
    assert.equal(t.ctl.getState().endReason, reason);
    assert.equal(t.camera.closed, true);
    assert.equal(t.client.disconnected, 1);
  }
  const t = harness();
  await goLive(t);
  t.ctl.dispose();
  assert.equal(t.camera.closed, true);
  assert.equal(t.client.disconnected, 1);
});

test('salir mientras se pide la sesión: lo que llega tarde se cierra y no se conecta', async () => {
  let release;
  const t = harness({
    requestSession: () =>
      new Promise((r) => {
        release = () => r(SESSION);
      }),
  });
  const started = t.ctl.start();
  await flush();
  t.ctl.dispose();
  release();
  await started;
  assert.equal(t.camera.closed, true);
  assert.equal(t.log.includes('connect:lucy-2.5'), false, 'no se abrió la sesión de Decart');
  assert.ok(t.log.includes(`end:${SESSION.sessionId}`), 'se liberó el cupo en el backend');
});

test('doble toque en Iniciar: una sola cámara y una sola sesión', async () => {
  const t = harness();
  await Promise.all([t.ctl.start(), t.ctl.start(), t.ctl.start()]);
  assert.equal(t.log.filter((l) => l === 'openCamera').length, 1);
  assert.equal(t.log.filter((l) => l === 'requestSession').length, 1);
});

test('permiso de cámara denegado o bloqueado: no se abre nada', async () => {
  const t = harness({ requestCameraPermission: async () => 'blocked' });
  await t.ctl.start();
  assert.deepEqual(t.ctl.getState().error, { kind: 'camera_denied', retryable: false, settings: true });
  assert.deepEqual(t.log, []);
});

test('cámara rechazada por el sistema (iOS) o no disponible', async () => {
  const denied = harness({ openCamera: async () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })) });
  await denied.ctl.start();
  assert.equal(denied.ctl.getState().error.kind, 'camera_denied');
  const missing = harness({ openCamera: async () => Promise.reject(new Error('no camera')) });
  await missing.ctl.start();
  assert.equal(missing.ctl.getState().error.kind, 'camera_unavailable');
  assert.equal(missing.log.includes('requestSession'), false, 'sin cámara no se firma token');
});

test('sin internet: avisa y no abre la cámara ni pide token', async () => {
  const t = harness({ isOnline: async () => false });
  await t.ctl.start();
  assert.equal(t.ctl.getState().error.kind, 'offline');
  assert.deepEqual(t.log, []);
});

test('tiempo agotado: si nunca empieza a generar, se corta a los 30 s', async () => {
  const t = harness();
  await t.ctl.start();
  t.clock.advance(core.CONNECT_TIMEOUT_MS);
  assert.equal(t.ctl.getState().error.kind, 'timeout');
  assert.equal(t.camera.closed, true);
  assert.equal(t.client.disconnected, 1);
});

test('conexión interrumpida o error del proveedor durante la sesión', async () => {
  const a = harness();
  await goLive(a);
  a.h().onConnectionChange('reconnecting');
  assert.equal(a.ctl.getState().phase, 'live', 'el SDK reintenta solo');
  a.h().onConnectionChange('disconnected');
  assert.equal(a.ctl.getState().error.kind, 'connection_lost');
  assert.equal(a.camera.closed, true);

  const b = harness();
  await goLive(b);
  b.h().onError({ code: 'WEBRTC_SERVER_ERROR', message: 'x' });
  assert.equal(b.ctl.getState().error.kind, 'connection_lost');

  const c = harness({ connect: async () => Promise.reject({ code: 'REACT_NATIVE_SETUP_REQUIRED' }) });
  await c.ctl.start();
  assert.equal(c.ctl.getState().error.kind, 'native_missing', 'p. ej. Expo Go sin LiveKit');
  assert.equal(c.camera.closed, true);
});

test('errores del backend: sesión vencida, plan, prenda, límites', async () => {
  const cases = [
    [{ sessionExpired: true }, 'session'],
    [{ status: 403 }, 'plan'],
    [{ status: 422, code: 'TRY_ON_NO_GARMENT_IMAGE' }, 'garment_no_image'],
    [{ status: 422, code: 'TRY_ON_GARMENT_IMAGE_TOO_SMALL' }, 'garment_image_too_small'],
    [{ status: 409, code: 'TRY_ON_IN_PROGRESS' }, 'busy'],
    [{ status: 429, code: 'TRY_ON_HOURLY_LIMIT' }, 'hourly_limit'],
    [{ status: 502, code: 'TRY_ON_FAILED' }, 'provider'],
    [{ networkError: true, online: false }, 'offline'],
  ];
  for (const [failure, kind] of cases) {
    const t = harness({ requestSession: async () => Promise.reject({ failure }) });
    await t.ctl.start();
    assert.equal(t.ctl.getState().error.kind, kind, JSON.stringify(failure));
    assert.equal(t.camera.closed, true, 'la cámara se apaga también si falla el backend');
  }
});

test('sesión que no corresponde (otra tienda o clave permanente): no se conecta', async () => {
  const t = harness({ requestSession: async () => ({ ...SESSION, apiKey: 'dct_permanent' }) });
  await t.ctl.start();
  assert.equal(t.ctl.getState().error.kind, 'mismatch');
  assert.equal(t.log.some((l) => l.startsWith('connect')), false);
  assert.ok(t.log.includes(`end:${SESSION.sessionId}`));
});

test('después de terminar se puede volver a iniciar', async () => {
  const t = harness();
  await goLive(t);
  t.ctl.stop('user');
  t.camera.closed = false;
  await t.ctl.start();
  assert.equal(t.ctl.getState().phase, 'connecting');
  assert.equal(t.log.filter((l) => l === 'requestSession').length, 2);
});
