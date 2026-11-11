import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { INestApplication, Logger } from '@nestjs/common';
import { Api, TENANT_A, TENANT_B, bootApp, withSql } from './support/world';
import { FakeKeyAttestationCa, KeyDescriptionOptions, opensslAvailable } from './support/mobile-integrity';
import { TenantResolutionCache } from '../../src/tenancy/tenant-resolution-cache.service';
import { MobileAccessService } from '../../src/modules/mobile-access/mobile-access.service';

// Android Key Attestation: APK instalada FUERA de Google Play (build EAS "preview"). La raíz de Google
// se reemplaza por una CA propia (openssl); la verificación del servidor es la real.

const PASSWORD = 'Secreta123!';
const PACKAGE = 'com.novasoft.si2';
// Mismo formato que imprime apksigner/keytool: hex con ":"
const SIGNING_CERT = Buffer.alloc(32, 0x5d);
const SIGNING_CERT_HEX = [...SIGNING_CERT].map((b) => b.toString(16).padStart(2, '0')).join(':');

const ENV = [
  'NODE_ENV',
  'MOBILE_ATTESTATION_DEV_BYPASS',
  'PLAY_INTEGRITY_PACKAGE_NAME',
  'PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON',
  'PLAY_INTEGRITY_CERT_SHA256',
  'APP_ATTEST_APP_ID',
  'APP_ATTEST_ROOT_CA_PEM',
  'ANDROID_KEY_ATTESTATION_PACKAGE_NAME',
  'ANDROID_KEY_ATTESTATION_CERT_SHA256',
  'ANDROID_KEY_ATTESTATION_ROOT_CA_PEM',
  'ANDROID_KEY_ATTESTATION_MIN_VERSION_CODE',
  'ANDROID_KEY_ATTESTATION_REVOCATION_URL',
];

const jwtPayload = (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));

describe('Canal móvil: APK fuera de Google Play con Android Key Attestation', { skip: !opensslAvailable() && 'openssl no disponible' }, () => {
  let app: INestApplication;
  let base: string;
  let ca: FakeKeyAttestationCa;
  let otherCa: FakeKeyAttestationCa;
  let savedEnv: Record<string, string | undefined>;
  let revoked: Record<string, unknown>;
  let revocationUp: boolean;
  let revocationUrl: string;
  const emails: Record<string, string> = {};

  const api = (tenantId: string, token?: string) => new Api(base, tenantId, token);
  const challenge = (tenantId: string) => api(tenantId).call('POST', '/auth/mobile/challenge');
  const login = (tenantId: string, email: string, attestation: unknown, password = PASSWORD) =>
    api(tenantId).call('POST', '/auth/mobile/login', { body: { email, password, attestation } });

  async function setPlan(tenantId: string, plan: string) {
    await withSql((c) => c.query('UPDATE public.tenants SET plan=$1 WHERE id=$2', [plan, tenantId]));
    app.get(TenantResolutionCache).invalidate(tenantId);
  }

  async function createLoginUser(schema: string): Promise<string> {
    const email = `k-${randomUUID()}@test.local`;
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

  /** Prueba como la arma la app: desafío → clave en el "TEE" con requestHash → cadena. */
  async function proof(tenantId: string, overrides: Partial<KeyDescriptionOptions> = {}, from = ca, hashFrom?: string) {
    const ch = await challenge(tenantId);
    assert.equal(ch.status, 200, JSON.stringify(ch.body));
    const { chain, leafSerial } = from.chainFor({
      challenge: hashFrom ?? ch.body.requestHash,
      packageName: PACKAGE,
      versionCode: 1,
      signatureDigest: SIGNING_CERT,
      ...overrides,
    });
    return { attestation: { challengeId: ch.body.challengeId, platform: 'android', certificateChain: chain }, leafSerial };
  }

  before(async () => {
    savedEnv = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
    app = await bootApp();
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    emails[TENANT_A.tenantId] = await createLoginUser(TENANT_A.schemaName);
    emails[TENANT_B.tenantId] = await createLoginUser(TENANT_B.schemaName);
    ca = new FakeKeyAttestationCa();
    otherCa = new FakeKeyAttestationCa();
  });

  beforeEach(async () => {
    for (const k of ENV) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    // Como producción hoy: sin Play Integrity ni App Attest, solo Key Attestation
    for (const k of ['PLAY_INTEGRITY_PACKAGE_NAME', 'PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON', 'APP_ATTEST_APP_ID', 'APP_ATTEST_ROOT_CA_PEM']) delete process.env[k];
    process.env.ANDROID_KEY_ATTESTATION_PACKAGE_NAME = PACKAGE;
    process.env.ANDROID_KEY_ATTESTATION_CERT_SHA256 = SIGNING_CERT_HEX;
    process.env.ANDROID_KEY_ATTESTATION_ROOT_CA_PEM = ca.rootPem.replace(/\n/g, '\\n'); // como queda en un secret
    // URL distinta por prueba: la lista se cachea por URL
    revocationUrl = `https://revocation-${randomUUID()}.test.invalid/status`;
    process.env.ANDROID_KEY_ATTESTATION_REVOCATION_URL = revocationUrl;
    revoked = {};
    revocationUp = true;
    app.get(MobileAccessService).fetchImpl = (async (url: string) => {
      if (url === revocationUrl && revocationUp) return { ok: true, status: 200, json: async () => ({ entries: revoked }) };
      return { ok: false, status: 503, json: async () => ({}) };
    }) as never;
    await setPlan(TENANT_A.tenantId, 'pro');
    await setPlan(TENANT_B.tenantId, 'pro');
  });

  after(async () => {
    for (const k of ENV) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    await setPlan(TENANT_A.tenantId, 'free');
    await setPlan(TENANT_B.tenantId, 'free');
    ca?.dispose();
    otherCa?.dispose();
    await app.close();
  });

  it('K01: el desafío anuncia Key Attestation; sin configuración, ningún método (caso de producción) y se registra la causa', async () => {
    const ok = await challenge(TENANT_A.tenantId);
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.platforms, { android: false, androidKeyAttestation: true, ios: false, development: false });

    delete process.env.ANDROID_KEY_ATTESTATION_PACKAGE_NAME;
    delete process.env.ANDROID_KEY_ATTESTATION_CERT_SHA256;
    delete process.env.ANDROID_KEY_ATTESTATION_ROOT_CA_PEM;
    const warnings: string[] = [];
    const original = Logger.prototype.warn;
    Logger.prototype.warn = function (message: unknown) {
      warnings.push(String(message));
    } as never;
    try {
      const none = await challenge(TENANT_A.tenantId);
      assert.deepEqual(none.body.platforms, { android: false, androidKeyAttestation: false, ios: false, development: false });
    } finally {
      Logger.prototype.warn = original;
    }
    assert.ok(warnings.some((w) => w.includes('Android sin método') && w.includes('Key Attestation no configurado')), warnings.join('\n'));
    assert.ok(!warnings.join('').includes('PRIVATE KEY'));
  });

  it('K02: login válido desde la APK → sesión móvil, att android-key-attestation', async () => {
    const { attestation } = await proof(TENANT_A.tenantId);
    const res = await login(TENANT_A.tenantId, emails[TENANT_A.tenantId], attestation);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(jwtPayload(res.body.accessToken).channel, 'mobile');
    assert.equal(jwtPayload(res.body.accessToken).att, 'android-key-attestation');
    assert.equal((await api(TENANT_A.tenantId, res.body.accessToken).call('GET', '/users/me')).status, 200);

    // La misma prueba no abre una segunda sesión
    assert.equal((await login(TENANT_A.tenantId, emails[TENANT_A.tenantId], attestation)).status, 401);
  });

  it('K03: prueba válida + credenciales inválidas → 401 de credenciales (no de integridad)', async () => {
    const { attestation } = await proof(TENANT_A.tenantId);
    const res = await login(TENANT_A.tenantId, emails[TENANT_A.tenantId], attestation, 'incorrecta');
    assert.equal(res.status, 401);
    assert.notEqual(res.body.code, 'MOBILE_ATTESTATION_INVALID');
  });

  it('K04: versión no autorizada (versionCode menor al mínimo) → 401', async () => {
    process.env.ANDROID_KEY_ATTESTATION_MIN_VERSION_CODE = '2';
    const old = await login(TENANT_A.tenantId, emails[TENANT_A.tenantId], (await proof(TENANT_A.tenantId, { versionCode: 1 })).attestation);
    assert.equal(old.status, 401);
    assert.equal(old.body.code, 'MOBILE_ATTESTATION_INVALID');
    const current = await login(TENANT_A.tenantId, emails[TENANT_A.tenantId], (await proof(TENANT_A.tenantId, { versionCode: 2 })).attestation);
    assert.equal(current.status, 200, JSON.stringify(current.body));
  });

  const invalid: [string, Partial<KeyDescriptionOptions>][] = [
    ['APK re-firmada con otro certificado', { signatureDigest: Buffer.alloc(32, 1) }],
    ['otro package', { packageName: 'com.pirata.app' }],
    ['keystore por software', { securityLevel: 0 }],
    ['bootloader desbloqueado', { deviceLocked: false, verifiedBootState: 2 }],
    ['arranque self-signed (ROM propia)', { verifiedBootState: 1 }],
    ['sin rootOfTrust', { omitRootOfTrust: true }],
    ['otro desafío', { challenge: 'x'.repeat(43) }],
  ];
  for (const [name, overrides] of invalid) {
    it(`K05 [${name}] → 401`, async () => {
      const res = await login(TENANT_A.tenantId, emails[TENANT_A.tenantId], (await proof(TENANT_A.tenantId, overrides)).attestation);
      assert.equal(res.status, 401);
      assert.equal(res.body.code, 'MOBILE_ATTESTATION_INVALID');
    });
  }

  it('K06: cadena de otra raíz, cadena alterada o certificado revocado → 401', async () => {
    const foreign = await login(TENANT_A.tenantId, emails[TENANT_A.tenantId], (await proof(TENANT_A.tenantId, {}, otherCa)).attestation);
    assert.equal(foreign.status, 401);

    const { attestation } = await proof(TENANT_A.tenantId);
    const tampered = { ...attestation, certificateChain: [attestation.certificateChain[0], attestation.certificateChain[2]] };
    assert.equal((await login(TENANT_A.tenantId, emails[TENANT_A.tenantId], tampered)).status, 401);

    const fresh = await proof(TENANT_A.tenantId);
    revoked[fresh.leafSerial] = { status: 'REVOKED', reason: 'KEY_COMPROMISE' };
    const res = await login(TENANT_A.tenantId, emails[TENANT_A.tenantId], fresh.attestation);
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'MOBILE_ATTESTATION_INVALID');
  });

  it('K07: lista de revocación de Google no disponible (sin copia) → 503, nunca acceso', async () => {
    revocationUp = false;
    const res = await login(TENANT_A.tenantId, emails[TENANT_A.tenantId], (await proof(TENANT_A.tenantId)).attestation);
    assert.equal(res.status, 503);
    assert.equal(res.body.code, 'MOBILE_ATTESTATION_UNAVAILABLE');
  });

  it('K08: configuración incompleta o inválida → canal cerrado (503), también en producción', async () => {
    delete process.env.ANDROID_KEY_ATTESTATION_CERT_SHA256;
    const noCert = await login(TENANT_A.tenantId, emails[TENANT_A.tenantId], (await proof(TENANT_A.tenantId)).attestation);
    assert.equal(noCert.status, 503);
    assert.equal(noCert.body.code, 'MOBILE_ATTESTATION_UNAVAILABLE');

    process.env.ANDROID_KEY_ATTESTATION_CERT_SHA256 = 'no-es-un-sha256';
    assert.equal((await login(TENANT_A.tenantId, emails[TENANT_A.tenantId], (await proof(TENANT_A.tenantId)).attestation)).status, 503);

    process.env.ANDROID_KEY_ATTESTATION_CERT_SHA256 = SIGNING_CERT_HEX;
    process.env.ANDROID_KEY_ATTESTATION_ROOT_CA_PEM = 'basura';
    assert.equal((await login(TENANT_A.tenantId, emails[TENANT_A.tenantId], (await proof(TENANT_A.tenantId)).attestation)).status, 503);

    // Producción no relaja nada ni habilita el atajo de desarrollo
    process.env.ANDROID_KEY_ATTESTATION_ROOT_CA_PEM = ca.rootPem;
    process.env.MOBILE_ATTESTATION_DEV_BYPASS = 'true';
    process.env.NODE_ENV = 'production';
    try {
      const ch = await challenge(TENANT_A.tenantId);
      assert.equal(ch.body.platforms.development, false);
      assert.equal((await login(TENANT_A.tenantId, emails[TENANT_A.tenantId], { challengeId: ch.body.challengeId, platform: 'development' })).status, 401);
      const ok = await login(TENANT_A.tenantId, emails[TENANT_A.tenantId], (await proof(TENANT_A.tenantId)).attestation);
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
    } finally {
      process.env.NODE_ENV = 'test';
    }
  });

  it('K09: tienda inexistente, tienda sin el plan y usuario de otra tienda', async () => {
    const ghost = await api(randomUUID()).call('POST', '/auth/mobile/challenge');
    assert.equal(ghost.status, 401);
    assert.equal(ghost.body.code, 'TENANT_REQUIRED');

    await setPlan(TENANT_B.tenantId, 'starter');
    const starter = await challenge(TENANT_B.tenantId);
    assert.equal(starter.status, 403);
    assert.equal(starter.body.code, 'MOBILE_APP_NOT_IN_PLAN');
    await setPlan(TENANT_B.tenantId, 'pro');

    // Usuario de B intentando entrar en A con una prueba válida para A
    const cross = await login(TENANT_A.tenantId, emails[TENANT_B.tenantId], (await proof(TENANT_A.tenantId)).attestation);
    assert.equal(cross.status, 401);
  });

  it('K10: aislamiento entre tiendas: prueba de A no sirve en B y el token de A no abre B', async () => {
    // Prueba con el challenge emitido para B, enviada a A
    const forB = await proof(TENANT_B.tenantId);
    assert.equal((await login(TENANT_A.tenantId, emails[TENANT_A.tenantId], forB.attestation)).status, 401);
    // Desafío de A pero firmado con el requestHash de B
    const chB = await challenge(TENANT_B.tenantId);
    const crossHash = await proof(TENANT_A.tenantId, {}, ca, chB.body.requestHash);
    const res = await login(TENANT_A.tenantId, emails[TENANT_A.tenantId], crossHash.attestation);
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'MOBILE_ATTESTATION_INVALID');

    const session = await login(TENANT_A.tenantId, emails[TENANT_A.tenantId], (await proof(TENANT_A.tenantId)).attestation);
    assert.equal(session.status, 200);
    assert.equal((await api(TENANT_B.tenantId, session.body.accessToken).call('GET', '/users/me')).status, 401);
  });
});
