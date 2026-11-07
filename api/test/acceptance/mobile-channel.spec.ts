import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Api, TENANT_A, TENANT_B, bootApp, withSql } from './support/world';
import {
  ANDROID_CERT,
  ANDROID_PACKAGE,
  FakeAppAttestCa,
  assertWith,
  attestKey,
  fakeGoogle,
  fakeIntegrityToken,
  fakeServiceAccount,
  goodVerdict,
  newDeviceKey,
  opensslAvailable,
} from './support/mobile-integrity';
import { TenantResolutionCache } from '../../src/tenancy/tenant-resolution-cache.service';
import { MobileAccessService } from '../../src/modules/mobile-access/mobile-access.service';

// Canal móvil protegido por plan + integridad. Google y Apple son dobles locales (ver
// support/mobile-integrity.ts); la lógica del servidor que valida sus respuestas es la real.

const PASSWORD = 'Secreta123!';
const APP_ID = 'ABCDE12345.com.novasoft.stellafemme';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const PHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';

const MOBILE_ENV = [
  'NODE_ENV',
  'MOBILE_ATTESTATION_DEV_BYPASS',
  'MOBILE_REATTEST_AFTER_MS',
  'MOBILE_ATTESTATION_CHALLENGE_TTL_MS',
  'PLAY_INTEGRITY_PACKAGE_NAME',
  'PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON',
  'PLAY_INTEGRITY_CERT_SHA256',
  'APP_ATTEST_APP_ID',
  'APP_ATTEST_ROOT_CA_PEM',
  'APP_ATTEST_ALLOW_DEVELOPMENT',
];

const jwtPayload = (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));

describe('Canal móvil: plan vigente + integridad verificada en el servidor', () => {
  let app: INestApplication;
  let base: string;
  let ca: FakeAppAttestCa | null = null;
  let savedEnv: Record<string, string | undefined>;
  const emails: Record<string, string> = {};

  const api = (tenantId: string, token?: string) => new Api(base, tenantId, token);

  async function setPlan(tenantId: string, plan: string, invalidate = true) {
    await withSql((c) => c.query('UPDATE public.tenants SET plan=$1 WHERE id=$2', [plan, tenantId]));
    // Igual que SubscriptionsService.syncTenant tras el webhook de Stripe
    if (invalidate) app.get(TenantResolutionCache).invalidate(tenantId);
  }

  async function createLoginUser(schema: string): Promise<string> {
    const email = `m-${randomUUID()}@test.local`;
    await withSql(async (c) => {
      const s = `"${schema}"`;
      const role = await c.query(`SELECT id FROM ${s}.roles WHERE name='Cliente'`);
      const roleId = role.rows[0]?.id ?? randomUUID();
      if (!role.rows[0]) await c.query(`INSERT INTO ${s}.roles (id,name,permissions,"updatedAt") VALUES ($1,'Cliente','{}',now())`, [roleId]);
      await c.query(`INSERT INTO ${s}.users (id,email,password,"roleId","updatedAt") VALUES ($1,$2,$3,$4,now())`, [
        randomUUID(),
        email,
        await bcrypt.hash(PASSWORD, 4),
        roleId,
      ]);
    });
    return email;
  }

  const challenge = (tenantId: string, headers: Record<string, string> = {}) =>
    api(tenantId).call('POST', '/auth/mobile/challenge', { headers });

  async function androidAttestation(tenantId: string, verdictOverrides: Record<string, any> = {}, hashFrom?: string) {
    const ch = await challenge(tenantId);
    assert.equal(ch.status, 200, JSON.stringify(ch.body));
    const requestHash = hashFrom ?? ch.body.requestHash;
    return { challengeId: ch.body.challengeId, platform: 'android', integrityToken: fakeIntegrityToken(goodVerdict(requestHash, verdictOverrides)) };
  }

  const mobileLogin = (tenantId: string, email: string, attestation: unknown) =>
    api(tenantId).call('POST', '/auth/mobile/login', { body: { email, password: PASSWORD, attestation } });

  async function proSession(tenantId: string) {
    const res = await mobileLogin(tenantId, emails[tenantId], await androidAttestation(tenantId));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body as { accessToken: string; refreshToken: string };
  }

  const mobileRefresh = (tenantId: string, refreshToken: string, body: unknown = {}) =>
    api(tenantId, refreshToken).call('POST', '/auth/mobile/refresh', { body });

  before(async () => {
    savedEnv = Object.fromEntries(MOBILE_ENV.map((k) => [k, process.env[k]]));
    app = await bootApp();
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    emails[TENANT_A.tenantId] = await createLoginUser(TENANT_A.schemaName);
    emails[TENANT_B.tenantId] = await createLoginUser(TENANT_B.schemaName);
    if (opensslAvailable()) ca = new FakeAppAttestCa();
  });

  beforeEach(async () => {
    for (const k of MOBILE_ENV) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    const sa = fakeServiceAccount();
    process.env.PLAY_INTEGRITY_PACKAGE_NAME = ANDROID_PACKAGE;
    process.env.PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON = sa.json;
    process.env.PLAY_INTEGRITY_CERT_SHA256 = ANDROID_CERT;
    if (ca) {
      process.env.APP_ATTEST_APP_ID = APP_ID;
      process.env.APP_ATTEST_ROOT_CA_PEM = ca.rootPem;
    }
    app.get(MobileAccessService).fetchImpl = fakeGoogle(sa.publicKey).fetchImpl as never;
    await setPlan(TENANT_A.tenantId, 'pro');
    await setPlan(TENANT_B.tenantId, 'starter');
  });

  after(async () => {
    for (const k of MOBILE_ENV) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    // Las demás suites asumen el plan por defecto
    await setPlan(TENANT_A.tenantId, 'free');
    await setPlan(TENANT_B.tenantId, 'free');
    ca?.dispose();
    await app.close();
  });

  // ---- Planes ----------------------------------------------------------------------------------
  for (const plan of ['starter', 'growth', 'free']) {
    it(`M01 [${plan}]: la app móvil no obtiene desafío, ni login, ni registro`, async () => {
      await setPlan(TENANT_B.tenantId, plan);
      const ch = await challenge(TENANT_B.tenantId);
      assert.equal(ch.status, 403);
      assert.equal(ch.body.code, 'MOBILE_APP_NOT_IN_PLAN');

      // Ni siquiera con una prueba de integridad válida emitida mientras la tienda era Pro
      await setPlan(TENANT_B.tenantId, 'pro');
      const attestation = await androidAttestation(TENANT_B.tenantId);
      await setPlan(TENANT_B.tenantId, plan);
      const login = await mobileLogin(TENANT_B.tenantId, emails[TENANT_B.tenantId], attestation);
      assert.equal(login.status, 403);
      assert.equal(login.body.code, 'MOBILE_APP_NOT_IN_PLAN');

      const register = await api(TENANT_B.tenantId).call('POST', '/auth/mobile/register', {
        body: { email: `r-${randomUUID()}@test.local`, password: PASSWORD, attestation },
      });
      assert.equal(register.status, 403);
    });
  }

  for (const plan of ['pro', 'legacy', 'PRO ']) {
    it(`M02 [${plan}]: con plan y prueba válida se abre una sesión móvil`, async () => {
      await setPlan(TENANT_A.tenantId, plan);
      const session = await proSession(TENANT_A.tenantId);
      assert.equal(jwtPayload(session.accessToken).channel, 'mobile');
      assert.equal(jwtPayload(session.accessToken).att, 'play-integrity');
      const me = await api(TENANT_A.tenantId, session.accessToken).call('GET', '/users/me');
      assert.equal(me.status, 200, JSON.stringify(me.body));
    });
  }

  it('M03: registro móvil en una tienda Pro', async () => {
    const res = await api(TENANT_A.tenantId).call('POST', '/auth/mobile/register', {
      body: { email: `r-${randomUUID()}@test.local`, password: PASSWORD, attestation: await androidAttestation(TENANT_A.tenantId) },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(jwtPayload(res.body.accessToken).channel, 'mobile');
  });

  // ---- Headers del cliente ---------------------------------------------------------------------
  it('M04: el header x-client-platform no habilita ni deshabilita el canal móvil protegido', async () => {
    // Pro + header "mobile" por el login web: token web, sin canal móvil
    const web = await api(TENANT_A.tenantId).call('POST', '/auth/login', {
      body: { email: emails[TENANT_A.tenantId], password: PASSWORD },
      headers: { 'x-client-platform': 'mobile' },
    });
    assert.equal(web.status, 200);
    assert.equal(jwtPayload(web.body.accessToken).channel, undefined);
    // Ese refresh web no se convierte en sesión móvil
    const upgrade = await mobileRefresh(TENANT_A.tenantId, web.body.refreshToken);
    assert.equal(upgrade.status, 401);
    assert.equal(upgrade.body.code, 'MOBILE_CHANNEL_MISMATCH');

    // Sin header, el canal móvil sigue exigiendo prueba: un login móvil sin attestation es 400
    const noProof = await api(TENANT_A.tenantId).call('POST', '/auth/mobile/login', { body: { email: emails[TENANT_A.tenantId], password: PASSWORD } });
    assert.equal(noProof.status, 400);
    // ...y en Starter, omitir el header no abre el desafío
    const starter = await challenge(TENANT_B.tenantId, {});
    assert.equal(starter.status, 403);
    // Falsificar el header "web" tampoco
    const forgedWeb = await challenge(TENANT_B.tenantId, { 'x-client-platform': 'web' });
    assert.equal(forgedWeb.status, 403);
  });

  it('M05: un claim channel "mobile" firmado con otro secreto o por el cliente no sirve', async () => {
    const jwt = app.get(JwtService, { strict: false });
    const claims = {
      sub: randomUUID(),
      email: 'x@test.local',
      tenantId: TENANT_A.tenantId,
      role: { id: 'r', name: 'Cliente' },
      permissions: [],
      channel: 'mobile',
      att: 'play-integrity',
    };
    const forged = jwt.sign(claims, { secret: 'otro-secreto', expiresIn: 60 });
    assert.equal((await api(TENANT_A.tenantId, forged).call('GET', '/users/me')).status, 401);
    const unsigned = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`;
    assert.equal((await api(TENANT_A.tenantId, unsigned).call('GET', '/users/me')).status, 401);
  });

  // ---- Aislamiento, pruebas inválidas y vencimientos ------------------------------------------
  it('M06: un token móvil de otra tienda es rechazado', async () => {
    await setPlan(TENANT_B.tenantId, 'pro');
    const sessionA = await proSession(TENANT_A.tenantId);
    assert.equal((await api(TENANT_B.tenantId, sessionA.accessToken).call('GET', '/users/me')).status, 401);
    assert.equal((await mobileRefresh(TENANT_B.tenantId, sessionA.refreshToken)).status, 401);
  });

  it('M07: un desafío o un requestHash de otra tienda no abre sesión', async () => {
    await setPlan(TENANT_B.tenantId, 'pro');
    // Desafío de B usado contra A
    const chB = await challenge(TENANT_B.tenantId);
    const crossChallenge = await mobileLogin(TENANT_A.tenantId, emails[TENANT_A.tenantId], {
      challengeId: chB.body.challengeId,
      platform: 'android',
      integrityToken: fakeIntegrityToken(goodVerdict(chB.body.requestHash)),
    });
    assert.equal(crossChallenge.status, 401);
    // Desafío de A con el requestHash calculado para B
    const crossHash = await mobileLogin(TENANT_A.tenantId, emails[TENANT_A.tenantId], await androidAttestation(TENANT_A.tenantId, {}, chB.body.requestHash));
    assert.equal(crossHash.status, 401);
    assert.equal(crossHash.body.code, 'MOBILE_ATTESTATION_INVALID');
  });

  const invalidVerdicts: [string, Record<string, any>][] = [
    ['app no reconocida por Play', { appIntegrity: { appRecognitionVerdict: 'UNRECOGNIZED_VERSION' } }],
    ['otro package', { appIntegrity: { packageName: 'com.pirata.app' } }],
    ['otro certificado de firma', { appIntegrity: { certificateSha256Digest: [Buffer.alloc(32, 1).toString('base64url')] } }],
    ['dispositivo sin integridad', { deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_BASIC_INTEGRITY'] } }],
    ['sin veredicto de dispositivo', { deviceIntegrity: { deviceRecognitionVerdict: [] } }],
    ['token viejo', { requestDetails: { timestampMillis: String(Date.now() - 10 * 60_000) } }],
  ];
  for (const [name, overrides] of invalidVerdicts) {
    it(`M08 [${name}]: prueba de Play Integrity inválida → 401`, async () => {
      const res = await mobileLogin(TENANT_A.tenantId, emails[TENANT_A.tenantId], await androidAttestation(TENANT_A.tenantId, overrides));
      assert.equal(res.status, 401);
      assert.equal(res.body.code, 'MOBILE_ATTESTATION_INVALID');
    });
  }

  it('M09: token ilegible para Google, desafío reusado, inexistente o vencido → 401', async () => {
    const ch = await challenge(TENANT_A.tenantId);
    const garbage = await mobileLogin(TENANT_A.tenantId, emails[TENANT_A.tenantId], { challengeId: ch.body.challengeId, platform: 'android', integrityToken: '%%%' });
    assert.equal(garbage.status, 401);

    const proof = await androidAttestation(TENANT_A.tenantId);
    assert.equal((await mobileLogin(TENANT_A.tenantId, emails[TENANT_A.tenantId], proof)).status, 200);
    const replay = await mobileLogin(TENANT_A.tenantId, emails[TENANT_A.tenantId], proof);
    assert.equal(replay.status, 401, 'la misma prueba no abre una segunda sesión');

    const unknown = await mobileLogin(TENANT_A.tenantId, emails[TENANT_A.tenantId], { ...proof, challengeId: randomUUID() });
    assert.equal(unknown.status, 401);

    const stale = await androidAttestation(TENANT_A.tenantId);
    await withSql((c) => c.query(`UPDATE public.mobile_attestation_challenges SET expires_at = now() - interval '1 second' WHERE id=$1`, [stale.challengeId]));
    assert.equal((await mobileLogin(TENANT_A.tenantId, emails[TENANT_A.tenantId], stale)).status, 401);
  });

  it('M10: la prueba se exige antes que la contraseña (fuerza bruta cuesta una prueba por intento)', async () => {
    const res = await api(TENANT_A.tenantId).call('POST', '/auth/mobile/login', {
      body: { email: emails[TENANT_A.tenantId], password: 'incorrecta', attestation: { challengeId: randomUUID(), platform: 'android', integrityToken: 'x' } },
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'MOBILE_ATTESTATION_INVALID');
  });

  it('M11: access token móvil vencido → 401', async () => {
    const session = await proSession(TENANT_A.tenantId);
    const { exp: _exp, iat: _iat, ...payload } = jwtPayload(session.accessToken);
    // Mismos claims y misma firma que la sesión real, pero vencido hace un minuto
    const expired = app.get(JwtService, { strict: false }).sign(payload, { secret: process.env.JWT_SECRET, expiresIn: -60 });
    assert.equal(jwtPayload(expired).channel, 'mobile');
    assert.equal((await api(TENANT_A.tenantId, expired).call('GET', '/users/me')).status, 401);
  });

  // ---- Cambio de plan y renovación ------------------------------------------------------------
  it('M12: bajar de plan corta la sesión móvil vigente y el refresh; volver a Pro la permite', async () => {
    const session = await proSession(TENANT_A.tenantId);
    await setPlan(TENANT_A.tenantId, 'growth');
    const me = await api(TENANT_A.tenantId, session.accessToken).call('GET', '/users/me');
    assert.equal(me.status, 403);
    assert.equal(me.body.code, 'MOBILE_APP_NOT_IN_PLAN');
    const refresh = await mobileRefresh(TENANT_A.tenantId, session.refreshToken);
    assert.equal(refresh.status, 403);

    await setPlan(TENANT_A.tenantId, 'pro');
    const again = await mobileRefresh(TENANT_A.tenantId, session.refreshToken);
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(jwtPayload(again.body.accessToken).channel, 'mobile');
  });

  it('M13: el refresh móvil lee el plan vigente aunque el cache del middleware siga diciendo Pro', async () => {
    const session = await proSession(TENANT_A.tenantId);
    await setPlan(TENANT_A.tenantId, 'starter', false); // sin invalidar: otra réplica, o el webhook no llegó a esta
    const refresh = await mobileRefresh(TENANT_A.tenantId, session.refreshToken);
    assert.equal(refresh.status, 403);
    assert.equal(refresh.body.code, 'MOBILE_APP_NOT_IN_PLAN');
  });

  it('M14: renovación rota tokens, conserva el canal y pide nueva prueba cuando vence la anterior', async () => {
    const session = await proSession(TENANT_A.tenantId);
    const first = await mobileRefresh(TENANT_A.tenantId, session.refreshToken);
    assert.equal(first.status, 200);
    assert.equal((await mobileRefresh(TENANT_A.tenantId, session.refreshToken)).status, 401, 'el refresh viejo quedó invalidado');

    process.env.MOBILE_REATTEST_AFTER_MS = '1';
    await new Promise((r) => setTimeout(r, 5));
    const needs = await mobileRefresh(TENANT_A.tenantId, first.body.refreshToken);
    assert.equal(needs.status, 401);
    assert.equal(needs.body.code, 'MOBILE_ATTESTATION_REQUIRED');
    const reattested = await mobileRefresh(TENANT_A.tenantId, first.body.refreshToken, { attestation: await androidAttestation(TENANT_A.tenantId) });
    assert.equal(reattested.status, 200, JSON.stringify(reattested.body));
    assert.equal(jwtPayload(reattested.body.refreshToken).channel, 'mobile');
  });

  it('M15: un refresh móvil no se canjea por /auth/refresh (sesión web sin chequeos)', async () => {
    const session = await proSession(TENANT_A.tenantId);
    const res = await api(TENANT_A.tenantId, session.refreshToken).call('POST', '/auth/refresh');
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'MOBILE_CHANNEL_MISMATCH');
  });

  // ---- Producción y atajo de desarrollo -------------------------------------------------------
  it('M16: el atajo de desarrollo solo existe fuera de producción y con la variable explícita', async () => {
    const devProof = async () => ({ challengeId: (await challenge(TENANT_A.tenantId)).body.challengeId, platform: 'development' });
    assert.equal((await mobileLogin(TENANT_A.tenantId, emails[TENANT_A.tenantId], await devProof())).status, 401, 'sin variable');

    process.env.MOBILE_ATTESTATION_DEV_BYPASS = 'true';
    const dev = await mobileLogin(TENANT_A.tenantId, emails[TENANT_A.tenantId], await devProof());
    assert.equal(dev.status, 200);
    assert.equal(jwtPayload(dev.body.accessToken).att, 'development-bypass');

    process.env.NODE_ENV = 'production';
    try {
      assert.equal((await mobileLogin(TENANT_A.tenantId, emails[TENANT_A.tenantId], await devProof())).status, 401, 'producción ignora el atajo');
      // Un token emitido con el atajo deja de valer en un servidor productivo
      assert.equal((await api(TENANT_A.tenantId, dev.body.accessToken).call('GET', '/users/me')).status, 401);
      assert.equal((await mobileRefresh(TENANT_A.tenantId, dev.body.refreshToken)).body.code, 'MOBILE_ATTESTATION_REQUIRED');
    } finally {
      process.env.NODE_ENV = 'test';
    }
  });

  it('M17: sin configuración del proveedor (o inválida en producción) el canal móvil queda cerrado', async () => {
    delete process.env.PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON;
    const missing = await mobileLogin(TENANT_A.tenantId, emails[TENANT_A.tenantId], await androidAttestation(TENANT_A.tenantId));
    assert.equal(missing.status, 503);
    assert.equal(missing.body.code, 'MOBILE_ATTESTATION_UNAVAILABLE');

    process.env.PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON = '{no-json';
    assert.equal((await mobileLogin(TENANT_A.tenantId, emails[TENANT_A.tenantId], await androidAttestation(TENANT_A.tenantId))).status, 503);

    // En producción el certificado de firma es obligatorio
    process.env.PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON = fakeServiceAccount().json;
    delete process.env.PLAY_INTEGRITY_CERT_SHA256;
    process.env.NODE_ENV = 'production';
    try {
      assert.equal((await mobileLogin(TENANT_A.tenantId, emails[TENANT_A.tenantId], await androidAttestation(TENANT_A.tenantId))).status, 503);
    } finally {
      process.env.NODE_ENV = 'test';
    }

    delete process.env.APP_ATTEST_APP_ID;
    delete process.env.APP_ATTEST_ROOT_CA_PEM;
    const ios = await mobileLogin(TENANT_A.tenantId, emails[TENANT_A.tenantId], {
      challengeId: (await challenge(TENANT_A.tenantId)).body.challengeId,
      platform: 'ios',
      keyId: 'a',
      assertion: 'b',
    });
    assert.equal(ios.status, 503);
  });

  // ---- iOS App Attest (CA de prueba con openssl) ----------------------------------------------
  it('M18: App Attest: atestación, aserciones con contador creciente, repetición y clave desconocida', async (t) => {
    if (!ca) return t.skip('openssl no disponible: no se puede fabricar la cadena de prueba');
    const key = newDeviceKey();
    const ch1 = (await challenge(TENANT_A.tenantId)).body;
    const first = await mobileLogin(TENANT_A.tenantId, emails[TENANT_A.tenantId], {
      challengeId: ch1.challengeId,
      platform: 'ios',
      keyId: key.keyId,
      attestation: attestKey(ca, key, APP_ID, ch1.clientData),
    });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(jwtPayload(first.body.accessToken).att, 'app-attest');

    const ch2 = (await challenge(TENANT_A.tenantId)).body;
    const assertion = assertWith(key, APP_ID, ch2.clientData);
    const second = await mobileLogin(TENANT_A.tenantId, emails[TENANT_A.tenantId], { challengeId: ch2.challengeId, platform: 'ios', keyId: key.keyId, assertion });
    assert.equal(second.status, 200, JSON.stringify(second.body));

    // Misma aserción con un desafío nuevo: la firma no corresponde
    const ch3 = (await challenge(TENANT_A.tenantId)).body;
    assert.equal((await mobileLogin(TENANT_A.tenantId, emails[TENANT_A.tenantId], { challengeId: ch3.challengeId, platform: 'ios', keyId: key.keyId, assertion })).status, 401);
    // Contador que no crece
    const ch4 = (await challenge(TENANT_A.tenantId)).body;
    const replayCounter = assertWith(key, APP_ID, ch4.clientData, key.counter);
    assert.equal((await mobileLogin(TENANT_A.tenantId, emails[TENANT_A.tenantId], { challengeId: ch4.challengeId, platform: 'ios', keyId: key.keyId, assertion: replayCounter })).status, 401);
    // Re-atestiguar una clave ya registrada
    const ch5 = (await challenge(TENANT_A.tenantId)).body;
    assert.equal((await mobileLogin(TENANT_A.tenantId, emails[TENANT_A.tenantId], { challengeId: ch5.challengeId, platform: 'ios', keyId: key.keyId, attestation: attestKey(ca, key, APP_ID, ch5.clientData) })).status, 401);

    // Clave nunca atestiguada: código específico para que la app genere otra
    const stranger = newDeviceKey();
    const ch6 = (await challenge(TENANT_A.tenantId)).body;
    const unknown = await mobileLogin(TENANT_A.tenantId, emails[TENANT_A.tenantId], { challengeId: ch6.challengeId, platform: 'ios', keyId: stranger.keyId, assertion: assertWith(stranger, APP_ID, ch6.clientData) });
    assert.equal(unknown.status, 401);
    assert.equal(unknown.body.code, 'APP_ATTEST_KEY_UNKNOWN');
  });

  it('M19: App Attest rechaza otra app, otro desafío, una CA ajena y el entorno de desarrollo', async (t) => {
    if (!ca) return t.skip('openssl no disponible');
    const login = async (build: (clientData: string, key: ReturnType<typeof newDeviceKey>) => string) => {
      const key = newDeviceKey();
      const ch = (await challenge(TENANT_A.tenantId)).body;
      return mobileLogin(TENANT_A.tenantId, emails[TENANT_A.tenantId], { challengeId: ch.challengeId, platform: 'ios', keyId: key.keyId, attestation: build(ch.clientData, key) });
    };
    assert.equal((await login((cd, k) => attestKey(ca!, k, 'ZZZZZ99999.com.pirata', cd))).status, 401, 'otro App ID');
    assert.equal((await login((_cd, k) => attestKey(ca!, k, APP_ID, 'otro desafío'))).status, 401, 'otro desafío');
    assert.equal((await login((cd, k) => attestKey(ca!, k, APP_ID, cd, 'development'))).status, 401, 'aaguid de desarrollo');
    const foreign = new FakeAppAttestCa();
    try {
      assert.equal((await login((cd, k) => attestKey(foreign, k, APP_ID, cd))).status, 401, 'CA que no es la configurada');
    } finally {
      foreign.dispose();
    }
    process.env.APP_ATTEST_ALLOW_DEVELOPMENT = 'true';
    assert.equal((await login((cd, k) => attestKey(ca!, k, APP_ID, cd, 'development'))).status, 200, 'desarrollo habilitado fuera de producción');
  });

  // ---- Web en todos los planes ----------------------------------------------------------------
  for (const plan of ['starter', 'growth', 'pro']) {
    it(`M20 [${plan}]: la tienda web sigue funcionando desde computadora y desde el navegador del teléfono`, async () => {
      await setPlan(TENANT_B.tenantId, plan);
      for (const ua of [DESKTOP_UA, PHONE_UA]) {
        const login = await api(TENANT_B.tenantId).call('POST', '/auth/login', { body: { email: emails[TENANT_B.tenantId], password: PASSWORD }, headers: { 'user-agent': ua } });
        assert.equal(login.status, 200, JSON.stringify(login.body));
        assert.equal(jwtPayload(login.body.accessToken).channel, undefined);
        const me = await api(TENANT_B.tenantId, login.body.accessToken).call('GET', '/users/me', { headers: { 'user-agent': ua } });
        assert.equal(me.status, 200);
        const refresh = await api(TENANT_B.tenantId, login.body.refreshToken).call('POST', '/auth/refresh', { headers: { 'user-agent': ua } });
        assert.equal(refresh.status, 200);
        const reg = await api(TENANT_B.tenantId).call('POST', '/auth/register', { body: { email: `w-${randomUUID()}@test.local`, password: PASSWORD }, headers: { 'user-agent': ua } });
        assert.equal(reg.status, 201, JSON.stringify(reg.body));
        const forgot = await api(TENANT_B.tenantId).call('POST', '/auth/forgot-password', { body: { email: emails[TENANT_B.tenantId] }, headers: { 'user-agent': ua } });
        assert.equal(forgot.status, 200);
        const catalog = await api(TENANT_B.tenantId).call('GET', '/products', { headers: { 'user-agent': ua } });
        assert.equal(catalog.status, 200);
      }
    });
  }
});
