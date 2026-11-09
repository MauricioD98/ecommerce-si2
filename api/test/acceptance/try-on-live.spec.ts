import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { TenantResolutionCache } from '../../src/tenancy/tenant-resolution-cache.service';
import { LiveSessionRegistry, imageSize, liveLimits } from '../../src/modules/try-on/try-on-live';
import { TENANT_A, TENANT_B, bootApp, createProduct, createUser, queryRows, seedTenant, tokenFor, type Fixture } from './support/world';

// Probador Virtual EN VIVO (app móvil, Decart lucy-2.5): POST /try-on/live-session con la API real y
// PostgreSQL, y un Decart FALSO local que solo emite tokens de cliente (nada sale a Internet ni se cobra).
// La sesión devuelta se valida con el MISMO código que corre en el teléfono (docs/app_movil/src/tryOn).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = require(join(process.cwd(), '..', 'docs', 'app_movil', 'src', 'tryOn', 'tryOnCore.js'));

const FAKE_KEY = 'dct_fake_acceptance_key';

// PNG con la cabecera IHDR del tamaño pedido (la API solo lee la cabecera: tipo y dimensiones)
function png(width: number, height: number): Buffer {
  const b = Buffer.alloc(64, 0);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}
const dataUrl = (bytes: Buffer, type = 'image/png') => `data:${type};base64,${bytes.toString('base64')}`;
const GOOD_GARMENT = dataUrl(png(768, 1024));

type Mode = 'ok' | 'fail' | 'provider-behind';
interface TokenCall {
  apiKey: string | undefined;
  body: any;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => resolve(s));
    req.on('error', reject);
  });
}

// Decart falso: misma ruta y cabecera que @decartai/sdk (tokens.create → POST {baseUrl}/v1/client/tokens)
function fakeDecart() {
  const state = { mode: 'ok' as Mode, calls: [] as TokenCall[], other: 0 };
  const server: Server = createServer(async (req, res) => {
    const raw = await readBody(req);
    if (req.method !== 'POST' || req.url !== '/v1/client/tokens') {
      state.other += 1;
      res.writeHead(404).end();
      return;
    }
    state.calls.push({ apiKey: req.headers['x-api-key'] as string | undefined, body: JSON.parse(raw || '{}') });
    if (state.mode === 'fail') {
      res.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"invalid key"}');
      return;
    }
    // provider-behind: el reloj de Decart va 60 s atrás del de esta máquina (como en la demo local)
    const providerNow = Date.now() - (state.mode === 'provider-behind' ? 60_000 : 0);
    const expiresAt = new Date(providerNow + (JSON.parse(raw).expiresIn ?? 60) * 1000).toISOString();
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ apiKey: `ek_fake_${state.calls.length}`, expiresAt }));
  });
  return { state, server };
}

describe('Probador en vivo: POST /try-on/live-session (Decart simulado)', () => {
  let app: INestApplication;
  let base: string;
  let fxA: Fixture;
  let fxB: Fixture;
  const decart = fakeDecart();
  let internalHits = 0;
  const internal = createServer((_req, res) => {
    internalHits += 1;
    res.writeHead(200, { 'content-type': 'image/png' }).end(png(800, 800));
  });
  let internalUrl = '';
  let ip = 0;
  const ENV_KEYS = ['DECART_API_KEY', 'DECART_BASE_URL', 'TRY_ON_LIVE_MAX_SECONDS', 'TRY_ON_LIVE_TOKEN_TTL_SECONDS', 'TRY_ON_LIVE_SESSIONS_PER_HOUR', 'TRY_ON_LIVE_MAX_CONCURRENT_PER_TENANT'];

  const setPlan = async (tenantId: string, plan: string) => {
    await queryRows('UPDATE public.tenants SET plan=$2 WHERE id=$1', [tenantId, plan]);
    app.get(TenantResolutionCache, { strict: false }).invalidate(tenantId);
  };

  const product = async (schema: string, fx: Fixture, imageUrl: string | null, isActive = true) => {
    const id = await createProduct(schema, fx, { [fx.branchA]: { M: 3 } });
    await queryRows(`UPDATE "${schema}".products SET "imageUrl"=$2, "isActive"=$3, name='Vestido rojo', colors=ARRAY['red'] WHERE id=$1`, [id, imageUrl, isActive]);
    return id;
  };

  const call = async (method: string, path: string, opts: { tenantId: string; token?: string; body?: unknown; lang?: string }) => {
    ip += 1;
    const res = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': opts.tenantId,
        'x-forwarded-for': `10.78.${(ip >> 8) & 255}.${ip & 255}`,
        'accept-language': opts.lang ?? 'es',
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await res.text();
    let body: any = text;
    try {
      body = JSON.parse(text);
    } catch {
      // texto plano
    }
    return { status: res.status, body };
  };
  const start = (tenantId: string, token: string | undefined, productId: string, lang?: string) =>
    call('POST', '/try-on/live-session', { tenantId, token, body: { productId }, lang });

  const newUser = async (tenant = TENANT_A, fx?: Fixture) => {
    const id = await createUser(tenant.schemaName, fx ?? fxA);
    return { id, token: tokenFor(app, id, tenant.tenantId) };
  };

  before(async () => {
    await new Promise<void>((r) => decart.server.listen(0, '127.0.0.1', () => r()));
    await new Promise<void>((r) => internal.listen(0, '127.0.0.1', () => r()));
    internalUrl = `http://127.0.0.1:${(internal.address() as AddressInfo).port}/garment.png`;
    app = await bootApp();
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    fxA = await seedTenant(TENANT_A.schemaName);
    fxB = await seedTenant(TENANT_B.schemaName);
    await setPlan(TENANT_A.tenantId, 'pro');
    await setPlan(TENANT_B.tenantId, 'pro');
  });

  beforeEach(() => {
    decart.state.mode = 'ok';
    process.env.DECART_API_KEY = FAKE_KEY;
    process.env.DECART_BASE_URL = `http://127.0.0.1:${(decart.server.address() as AddressInfo).port}`;
    process.env.TRY_ON_LIVE_MAX_SECONDS = '';
    process.env.TRY_ON_LIVE_TOKEN_TTL_SECONDS = '';
    process.env.TRY_ON_LIVE_SESSIONS_PER_HOUR = '';
    // Cada prueba usa clientes nuevos; el tope por tienda se prueba aparte con la tienda B
    process.env.TRY_ON_LIVE_MAX_CONCURRENT_PER_TENANT = '100';
  });

  after(async () => {
    for (const key of ENV_KEYS) process.env[key] = '';
    await app?.close();
    await new Promise((r) => decart.server.close(r));
    await new Promise((r) => internal.close(r));
  });

  it('L01: token de cliente solo para lucy-2.5, con duración máxima de 60 s, para esa tienda, cliente y prenda', async () => {
    const { id, token } = await newUser();
    const productId = await product(TENANT_A.schemaName, fxA, GOOD_GARMENT);
    const before = decart.state.calls.length;

    const config = await call('GET', '/try-on/live-config', { tenantId: TENANT_A.tenantId, token });
    assert.deepEqual(config.body.data, { model: 'lucy-2.5', maxSessionSeconds: 60 });

    const res = await start(TENANT_A.tenantId, token, productId);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const s = res.body.data;
    assert.equal(s.model, 'lucy-2.5');
    assert.equal(s.maxSessionSeconds, 60);
    assert.equal(s.tenantId, TENANT_A.tenantId);
    assert.equal(s.userId, id);
    assert.equal(s.productId, productId);
    assert.match(s.apiKey, /^ek_fake_/, 'token de cliente, nunca la clave permanente');
    assert.ok(!JSON.stringify(res.body).includes(FAKE_KEY), 'la clave permanente no sale del backend');
    assert.equal(s.garmentImage, GOOD_GARMENT, 'la prenda del catálogo es la referencia');
    assert.match(s.prompt, /red Vestido rojo/);

    // Lo que firmó el backend en Decart
    assert.equal(decart.state.calls.length, before + 1);
    const sent = decart.state.calls.at(-1)!;
    assert.equal(sent.apiKey, FAKE_KEY);
    assert.deepEqual(sent.body.allowedModels, ['lucy-2.5']);
    assert.deepEqual(sent.body.constraints, { realtime: { maxSessionDuration: 60 } });
    assert.equal(sent.body.expiresIn, 30);
    assert.equal(sent.body.allowedOrigins, undefined, 'la app nativa no manda Origin');
    assert.deepEqual(sent.body.metadata, { tenantId: TENANT_A.tenantId, userId: id, productId, sessionId: s.sessionId });

    // El teléfono la acepta solo para su tienda, cuenta y prenda
    const expected = { tenantId: TENANT_A.tenantId, userId: id, productId };
    assert.equal(core.isSessionFor(s, expected), true);
    assert.equal(core.isSessionFor(s, { ...expected, tenantId: TENANT_B.tenantId }), false);
    assert.equal(core.isSessionFor(s, { ...expected, userId: TENANT_B.tenantId }), false);
  });

  it('L02: la duración máxima es configurable (TRY_ON_LIVE_MAX_SECONDS) y se acota al mínimo de Decart', async () => {
    const productId = await product(TENANT_A.schemaName, fxA, GOOD_GARMENT);
    process.env.TRY_ON_LIVE_MAX_SECONDS = '45';
    const a = await newUser();
    const res = await start(TENANT_A.tenantId, a.token, productId);
    assert.equal(res.body.data.maxSessionSeconds, 45);
    assert.deepEqual(decart.state.calls.at(-1)!.body.constraints, { realtime: { maxSessionDuration: 45 } });

    process.env.TRY_ON_LIVE_MAX_SECONDS = '3';
    const b = await newUser();
    assert.equal((await start(TENANT_A.tenantId, b.token, productId)).body.data.maxSessionSeconds, 10);
  });

  it('L03: sin sesión, sesión de otra tienda, plan Starter o prenda de otra tienda → no se firma nada', async () => {
    const productA = await product(TENANT_A.schemaName, fxA, GOOD_GARMENT);
    const productB = await product(TENANT_B.schemaName, fxB, GOOD_GARMENT);
    const userB = await newUser(TENANT_B, fxB);
    const before = decart.state.calls.length;

    const anonymous = await start(TENANT_A.tenantId, undefined, productA);
    assert.equal(anonymous.status, 401);
    assert.equal(core.classifyApiFailure({ status: anonymous.status }).kind, 'session');

    assert.equal((await start(TENANT_A.tenantId, userB.token, productA)).status, 401, 'token de otra tienda');

    const userA = await newUser();
    const cross = await start(TENANT_A.tenantId, userA.token, productB);
    assert.equal(cross.status, 404);
    assert.equal(cross.body.code, 'TRY_ON_PRODUCT_UNAVAILABLE');

    await setPlan(TENANT_A.tenantId, 'starter');
    try {
      const starter = await start(TENANT_A.tenantId, userA.token, productA);
      assert.equal(starter.status, 403);
      assert.match(starter.body.message, /Probador Virtual.*Pro/);
      assert.equal((await call('GET', '/try-on/live-config', { tenantId: TENANT_A.tenantId, token: userA.token })).status, 403);
    } finally {
      await setPlan(TENANT_A.tenantId, 'pro');
    }
    assert.equal(decart.state.calls.length, before);
  });

  it('L04: prenda sin imagen compatible → explica el motivo (sin foto, inactiva, baja resolución, formato, red interna)', async () => {
    const { token } = await newUser();
    const before = decart.state.calls.length;
    const expectCode = async (imageUrl: string | null, status: number, code: string, isActive = true, lang?: string) => {
      const res = await start(TENANT_A.tenantId, token, await product(TENANT_A.schemaName, fxA, imageUrl, isActive), lang);
      assert.equal(res.status, status, JSON.stringify(res.body));
      assert.equal(res.body.code, code);
      return res;
    };

    const noImage = await expectCode(null, 422, 'TRY_ON_NO_GARMENT_IMAGE', true, 'zh');
    assert.equal(noImage.body.message, '该商品没有参考图片，因此无法用于试衣。');
    await expectCode(GOOD_GARMENT, 404, 'TRY_ON_PRODUCT_UNAVAILABLE', false);
    const small = await expectCode(dataUrl(png(120, 160)), 422, 'TRY_ON_GARMENT_IMAGE_TOO_SMALL', true, 'en');
    assert.equal(small.body.message, 'The reference photo of this item has too low a resolution for the live try-on.');
    await expectCode(dataUrl(Buffer.from('<svg/>'), 'image/svg+xml'), 422, 'TRY_ON_GARMENT_IMAGE_UNAVAILABLE');

    const hits = internalHits;
    await expectCode(internalUrl, 422, 'TRY_ON_GARMENT_IMAGE_UNAVAILABLE');
    assert.equal(internalHits, hits, 'la API no descargó nada de 127.0.0.1 (SSRF)');

    assert.equal(core.classifyApiFailure({ status: 422, code: 'TRY_ON_GARMENT_IMAGE_TOO_SMALL' }).kind, 'garment_image_too_small');
    assert.equal(decart.state.calls.length, before);
  });

  it('L05: una sesión a la vez por cliente; Finalizar no libera el cupo mientras el token siga vigente', async () => {
    process.env.TRY_ON_LIVE_TOKEN_TTL_SECONDS = '10';
    const { token } = await newUser();
    const other = await newUser();
    const productId = await product(TENANT_A.schemaName, fxA, GOOD_GARMENT);

    const first = await start(TENANT_A.tenantId, token, productId);
    assert.equal(first.status, 200);
    const second = await start(TENANT_A.tenantId, token, productId);
    assert.equal(second.status, 409);
    assert.equal(second.body.code, 'TRY_ON_IN_PROGRESS');
    assert.ok(second.body.retryAfterSeconds > 0);
    assert.equal(core.classifyApiFailure({ status: 409, code: second.body.code }).kind, 'busy');

    // Otro cliente no puede cerrar una sesión ajena
    const foreign = await call('POST', `/try-on/live-session/${first.body.data.sessionId}/end`, { tenantId: TENANT_A.tenantId, token: other.token });
    assert.deepEqual(foreign.body.data, { ended: false });

    const ended = await call('POST', `/try-on/live-session/${first.body.data.sessionId}/end`, { tenantId: TENANT_A.tenantId, token });
    assert.deepEqual(ended.body.data, { ended: true });
    assert.equal((await start(TENANT_A.tenantId, token, productId)).status, 409, 'el token (no revocable) sigue sirviendo 10 s');

    await new Promise((r) => setTimeout(r, 10_500));
    assert.equal((await start(TENANT_A.tenantId, token, productId)).status, 200, 'vencido el token, puede volver a probar');
  });

  it('L06: tope de sesiones simultáneas por tienda', async () => {
    process.env.TRY_ON_LIVE_MAX_CONCURRENT_PER_TENANT = '2';
    const productId = await product(TENANT_B.schemaName, fxB, GOOD_GARMENT);
    const users = [await newUser(TENANT_B, fxB), await newUser(TENANT_B, fxB), await newUser(TENANT_B, fxB)];
    assert.equal((await start(TENANT_B.tenantId, users[0].token, productId)).status, 200);
    assert.equal((await start(TENANT_B.tenantId, users[1].token, productId)).status, 200);
    const third = await start(TENANT_B.tenantId, users[2].token, productId);
    assert.equal(third.status, 409);
    assert.equal(third.body.code, 'TRY_ON_STORE_BUSY');
  });

  it('L07: error del proveedor al firmar → 502 TRY_ON_FAILED y el cupo se devuelve', async () => {
    const { token } = await newUser();
    const productId = await product(TENANT_A.schemaName, fxA, GOOD_GARMENT);
    decart.state.mode = 'fail';
    const failed = await start(TENANT_A.tenantId, token, productId);
    assert.equal(failed.status, 502);
    assert.equal(failed.body.code, 'TRY_ON_FAILED');
    assert.deepEqual(core.classifyApiFailure({ status: 502, code: failed.body.code }), { kind: 'provider', retryable: true });

    decart.state.mode = 'ok';
    assert.equal((await start(TENANT_A.tenantId, token, productId)).status, 200, 'el intento fallido no dejó la sesión ocupada');
  });

  it('L08: tienda sin clave de Decart → 503 TRY_ON_NOT_ENABLED', async () => {
    const { token } = await newUser();
    const productId = await product(TENANT_A.schemaName, fxA, GOOD_GARMENT);
    process.env.DECART_API_KEY = '';
    const res = await start(TENANT_A.tenantId, token, productId);
    assert.equal(res.status, 503);
    assert.equal(res.body.code, 'TRY_ON_NOT_ENABLED');
  });

  it('L09: el probador web sigue funcionando (POST /try-on/session sin cambios)', async () => {
    const { token } = await newUser();
    // Su token se firma contra el Decart real del SDK (no usa DECART_BASE_URL): solo se comprueba que
    // la ruta y sus guards siguen en pie sin llamar al proveedor (sin clave → 503)
    process.env.DECART_API_KEY = '';
    const res = await call('POST', '/try-on/session', { tenantId: TENANT_A.tenantId, token });
    assert.equal(res.status, 503);
    await setPlan(TENANT_A.tenantId, 'starter');
    try {
      assert.equal((await call('POST', '/try-on/session', { tenantId: TENANT_A.tenantId, token })).status, 403);
    } finally {
      await setPlan(TENANT_A.tenantId, 'pro');
    }
  });

  it('L12: teléfono con el reloj adelantado: el token se alarga esa diferencia; desfase absurdo → aviso', async () => {
    const productId = await product(TENANT_A.schemaName, fxA, GOOD_GARMENT);
    const a = await newUser();
    const ahead = await call('POST', '/try-on/live-session', { tenantId: TENANT_A.tenantId, token: a.token, body: { productId, clientTime: Date.now() + 60_000 } });
    assert.equal(ahead.status, 200);
    const ttl = decart.state.calls.at(-1)!.body.expiresIn;
    assert.ok(ttl >= 89 && ttl <= 91, `30 s + ~60 s de desfase (fue ${ttl})`);

    const b = await newUser();
    const behind = await call('POST', '/try-on/live-session', { tenantId: TENANT_A.tenantId, token: b.token, body: { productId, clientTime: Date.now() - 120_000 } });
    assert.equal(behind.status, 200);
    assert.equal(decart.state.calls.at(-1)!.body.expiresIn, 30, 'atrasado no necesita compensación');

    // Backend y teléfono con la misma hora, pero Decart 60 s atrás: se vuelve a firmar con +60 s
    decart.state.mode = 'provider-behind';
    const d = await newUser();
    const beforeSkew = decart.state.calls.length;
    const skewed = await call('POST', '/try-on/live-session', { tenantId: TENANT_A.tenantId, token: d.token, body: { productId, clientTime: Date.now() } });
    assert.equal(skewed.status, 200);
    assert.equal(decart.state.calls.length, beforeSkew + 2, 'una firma de prueba y una corregida');
    const corrected = decart.state.calls.at(-1)!.body.expiresIn;
    assert.ok(corrected >= 89 && corrected <= 91, `30 s + 60 s contra el reloj de Decart (fue ${corrected})`);
    decart.state.mode = 'ok';

    const c = await newUser();
    const before = decart.state.calls.length;
    const wild = await call('POST', '/try-on/live-session', { tenantId: TENANT_A.tenantId, token: c.token, body: { productId, clientTime: Date.now() + 600_000 }, lang: 'en' });
    assert.equal(wild.status, 422);
    assert.equal(wild.body.code, 'TRY_ON_CLOCK_SKEW');
    assert.equal(core.classifyApiFailure({ status: 422, code: wild.body.code }).kind, 'clock_skew');
    assert.equal(decart.state.calls.length, before);
  });

  it('L10: registro de sesiones con reloj simulado: límite por hora y vencimiento', () => {
    let now = 0;
    const registry = new LiveSessionRegistry(() => now);
    const limits = { ...liveLimits(), maxSessionSeconds: 60, tokenTtlSeconds: 30, sessionsPerHourPerUser: 2, concurrentPerTenant: 5 };
    const acquire = (id: string) => registry.acquire({ id, tenantId: 't', userId: 'u', limits });

    assert.equal(acquire('a').ok, true);
    const busy = acquire('b');
    assert.equal(busy.ok, false);
    now += 30_000;
    assert.equal(registry.end('a', 't', 'u'), true);
    assert.equal(acquire('c').ok, true, 'token vencido + Finalizar → cupo libre');
    now += 106_000; // vence c sola (30 + 60 + 15 s)
    const hourly = acquire('d');
    assert.deepEqual(hourly.ok ? null : hourly.reason, 'hourly_limit');
    now += 3_600_000;
    assert.equal(acquire('e').ok, true, 'pasada la hora vuelve a poder');
    registry.cancel('e');
    assert.equal(registry.activeCount('t'), 0);
  });

  it('L11: dimensiones de la prenda leídas de la cabecera (PNG, JPEG, WebP)', () => {
    assert.deepEqual(imageSize(png(768, 1024), 'image/png'), { width: 768, height: 1024 });
    // JPEG mínimo: SOI + SOF0 con 600x800
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0x20, 0x02, 0x58, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
    assert.deepEqual(imageSize(jpeg, 'image/jpeg'), { width: 600, height: 800 });
    const webp = Buffer.alloc(40, 0);
    webp.write('RIFF', 0, 'ascii');
    webp.write('WEBP', 8, 'ascii');
    webp.write('VP8X', 12, 'ascii');
    webp.writeUIntLE(511, 24, 3);
    webp.writeUIntLE(639, 27, 3);
    assert.deepEqual(imageSize(webp, 'image/webp'), { width: 512, height: 640 });
  });
});
