import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { TenantResolutionCache } from '../../src/tenancy/tenant-resolution-cache.service';
import { Api, TENANT_A, bootApp, queryRows, seedTenant } from './support/world';

// Las respuestas de autenticación no exponen secretos ni estado interno: ni el hash de la contraseña,
// ni el hash del refresh token guardado, ni el código de recuperación, ni los campos de bloqueo. Se
// recorre todo el JSON (objetos anidados incluidos) y además se busca el valor real guardado en la base.

const schema = TENANT_A.schemaName;
const tenant = TENANT_A.tenantId;
const PASSWORD = 'Privacidad2026!';
const MOBILE_ENV = ['MOBILE_ATTESTATION_DEV_BYPASS'] as const;

// Claves que nunca deben aparecer, en ningún nivel
const FORBIDDEN_KEYS = new Set([
  'password',
  'passwordHash',
  'loginAttempts',
  'lockedUntil',
  'resetPasswordOtp',
  'resetPasswordAttempts',
  'resetPasswordExpires',
  'hashedRefreshToken',
]);
const BCRYPT_RE = /^\$2[abxy]\$\d{2}\$/;
const USER_FIELDS = ['id', 'email', 'firstName', 'lastName', 'phone', 'preferredBranchId', 'branchId', 'employeeDiscount', 'createdAt', 'updatedAt', 'role', 'permissions'];

function findLeaks(value: unknown, path = '$', insideUser = false): string[] {
  if (typeof value === 'string') return BCRYPT_RE.test(value) ? [`${path} parece un hash bcrypt`] : [];
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((item, i) => findLeaks(item, `${path}[${i}]`, insideUser));
  const leaks: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) leaks.push(`${path}.${key}`);
    // El refresh token es parte del contrato junto al access token, nunca dentro del usuario
    if (insideUser && key === 'refreshToken') leaks.push(`${path}.${key}`);
    leaks.push(...findLeaks(child, `${path}.${key}`, insideUser || key === 'user'));
  }
  return leaks;
}

describe('Respuestas de autenticación sin datos sensibles (web, móvil y login unificado)', () => {
  let app: INestApplication;
  let base: string;
  let previousPlan: string;
  const savedEnv: Partial<Record<(typeof MOBILE_ENV)[number], string>> = {};
  let email: string;

  const api = (token?: string) => new Api(base, tenant, token);
  const session = (body: any) => body?.data?.auth ?? body?.data ?? body;

  // Lo guardado en la base para este usuario: ninguno de esos valores puede viajar al cliente
  async function storedSecrets(): Promise<string[]> {
    const [row] = await queryRows(`SELECT password, "refreshToken", "resetPasswordOtp" FROM "${schema}".users WHERE email=$1`, [email]);
    return [row.password, row.refreshToken, row.resetPasswordOtp].filter((v): v is string => typeof v === 'string' && v.length > 0);
  }

  async function assertClean(label: string, res: { status: number; body: any }, expectUser = true) {
    assert.ok(res.status === 200 || res.status === 201, `${label}: ${res.status} ${JSON.stringify(res.body)}`);
    assert.deepEqual(findLeaks(res.body), [], `${label}: campos sensibles en la respuesta`);
    const text = JSON.stringify(res.body);
    for (const secret of await storedSecrets()) {
      assert.ok(!text.includes(secret), `${label}: la respuesta contiene un valor guardado en la base`);
    }
    if (expectUser) {
      const user = session(res.body).user ?? res.body?.data ?? res.body;
      assert.deepEqual(Object.keys(user).sort(), [...USER_FIELDS].sort(), `${label}: el usuario debe tener exactamente los campos del contrato`);
      assert.equal(user.email, email);
      assert.equal(typeof user.role?.name, 'string');
      assert.ok(Array.isArray(user.permissions));
    }
  }

  before(async () => {
    for (const name of MOBILE_ENV) savedEnv[name] = process.env[name];
    // Atajo de desarrollo del canal móvil: lo respeta solo con NODE_ENV de pruebas (support/env.ts)
    process.env.MOBILE_ATTESTATION_DEV_BYPASS = 'true';
    const [row] = await queryRows(`SELECT plan FROM public.tenants WHERE id=$1`, [tenant]);
    previousPlan = row.plan;
    await queryRows(`UPDATE public.tenants SET plan='pro' WHERE id=$1`, [tenant]);
    app = await bootApp();
    app.get(TenantResolutionCache).invalidate(tenant);
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    await seedTenant(schema);
    email = `privacidad-${randomUUID()}@test.local`;
  });
  after(async () => {
    await app.close();
    await queryRows(`UPDATE public.tenants SET plan=$2 WHERE id=$1`, [tenant, previousPlan]);
    for (const name of MOBILE_ENV) {
      if (savedEnv[name] === undefined) delete process.env[name];
      else process.env[name] = savedEnv[name];
    }
  });

  it('S01: registro y login web por tienda, con refresh y perfil', async () => {
    const registered = await api().call('POST', '/auth/register', { body: { email, password: PASSWORD, firstName: 'Ana', lastName: 'Privada' } });
    await assertClean('POST /auth/register', registered);

    // Estado interno a la vista en la base: intentos fallidos, bloqueo vencido y un código de recuperación
    assert.equal((await api().call('POST', '/auth/login', { body: { email, password: 'Incorrecta2026!' } })).status, 401);
    assert.ok([200, 201].includes((await api().call('POST', '/auth/forgot-password', { body: { email } })).status));
    await queryRows(`UPDATE "${schema}".users SET "lockedUntil" = now() - interval '1 minute' WHERE email=$1`, [email]);
    const [internal] = await queryRows(`SELECT "loginAttempts", "resetPasswordOtp" FROM "${schema}".users WHERE email=$1`, [email]);
    assert.ok(internal.loginAttempts > 0 && internal.resetPasswordOtp, 'la prueba necesita estado interno que pueda filtrarse');

    const login = await api().call('POST', '/auth/login', { body: { email, password: PASSWORD } });
    await assertClean('POST /auth/login', login);
    const { accessToken, refreshToken } = session(login.body);
    assert.ok(accessToken && refreshToken, 'el login web sigue entregando sus tokens');

    await assertClean('GET /users/me', await api(accessToken).call('GET', '/users/me'));
    const refreshed = await api(refreshToken).call('POST', '/auth/refresh');
    await assertClean('POST /auth/refresh', refreshed);
    assert.ok(session(refreshed.body).accessToken);
  });

  it('S02: login unificado de la plataforma (tienda elegida)', async () => {
    const res = await api().call('POST', '/platform/auth/tenant-login', { body: { email, password: PASSWORD, tenantId: tenant } });
    await assertClean('POST /platform/auth/tenant-login', res);
    assert.equal(res.body.data.tenant.id, tenant);
    const { accessToken } = session(res.body);
    assert.ok(accessToken);
    // La sesión sirve: el front la usa contra la tienda
    assert.equal((await api(accessToken).call('GET', '/cart')).status, 200);
  });

  it('S03: login móvil, uso de la sesión y refresh móvil', async () => {
    const mobile = (token?: string) => new Api(base, tenant, token);
    const headers = { 'x-client-platform': 'mobile' };
    const challenge = await mobile().call('POST', '/auth/mobile/challenge', { headers });
    assert.equal(challenge.status, 200, JSON.stringify(challenge.body));
    const challengeId = (challenge.body.data ?? challenge.body).challengeId;
    const res = await mobile().call('POST', '/auth/mobile/login', {
      headers,
      body: { email, password: PASSWORD, attestation: { challengeId, platform: 'development' } },
    });
    await assertClean('POST /auth/mobile/login', res);
    const { accessToken, refreshToken } = session(res.body);
    const claims = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8'));
    assert.equal(claims.channel, 'mobile');
    assert.equal((await mobile(accessToken).call('GET', '/cart', { headers })).status, 200);
    await assertClean('GET /users/me (móvil)', await mobile(accessToken).call('GET', '/users/me', { headers }));
    await assertClean('POST /auth/mobile/refresh', await mobile(refreshToken).call('POST', '/auth/mobile/refresh', { headers, body: {} }));
  });

  it('S04: el detector encuentra fugas anidadas (control de la propia prueba)', () => {
    const leaky = { data: { auth: { accessToken: 'a', refreshToken: 'r', user: { id: '1', password: '$2b$12$abcdefghijklmnopqrstuv', meta: { lockedUntil: null, refreshToken: 'x' } } } } };
    assert.deepEqual(findLeaks(leaky).sort(), [
      '$.data.auth.user.meta.lockedUntil',
      '$.data.auth.user.meta.refreshToken',
      '$.data.auth.user.password',
      '$.data.auth.user.password parece un hash bcrypt',
    ]);
    assert.deepEqual(findLeaks({ data: { accessToken: 'a', refreshToken: 'r', user: { id: '1' } } }), []);
  });
});
