import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { Client } from 'pg';
import { TENANT_A, TENANT_B, apiFor, bootApp, seedTenant, withSql, type Api } from './support/world';

// POST /platform/auth/tenant-login: la tienda se elige antes de autenticar y solo se consulta esa
const PASSWORD = 'Clave-Segura-123';

async function createLoginUser(schema: string, roleId: string, email: string, password = PASSWORD): Promise<string> {
  const id = randomUUID();
  const hash = await bcrypt.hash(password, 4);
  await withSql((c) =>
    c.query(`INSERT INTO "${schema}".users (id,email,password,"roleId","updatedAt") VALUES ($1,$2,$3,$4,now())`, [id, email, hash, roleId]),
  );
  return id;
}

// Cuenta cada SQL que la app manda a PostgreSQL (mismo módulo `pg` que usa @prisma/adapter-pg)
function captureQueries() {
  const proto = Client.prototype as unknown as { query: (...args: unknown[]) => unknown };
  const original = proto.query;
  const texts: string[] = [];
  proto.query = function (this: unknown, ...args: unknown[]) {
    const first = args[0] as string | { text?: string };
    texts.push(typeof first === 'string' ? first : (first?.text ?? ''));
    return original.apply(this, args);
  };
  return {
    texts,
    stop: () => {
      proto.query = original;
    },
  };
}

describe('Login de tienda: la tienda se elige antes de autenticar', () => {
  let app: INestApplication;
  let api: Api;
  let roleA: string;
  let roleB: string;
  const sharedEmail = `compartido-${randomUUID()}@test.local`;
  let userA: string;
  let userB: string;

  const login = (body: Record<string, unknown>) => api.call('POST', '/platform/auth/tenant-login', { body });

  before(async () => {
    app = await bootApp();
    roleA = (await seedTenant(TENANT_A.schemaName)).roleId;
    roleB = (await seedTenant(TENANT_B.schemaName)).roleId;
    // Mismo correo y misma contraseña en dos tiendas
    userA = await createLoginUser(TENANT_A.schemaName, roleA, sharedEmail);
    userB = await createLoginUser(TENANT_B.schemaName, roleB, sharedEmail);
    api = await apiFor(app, TENANT_A.tenantId);
  });
  after(() => app.close());

  it('L1: login correcto en la tienda seleccionada (correo normalizado) y token atado a esa tienda', async () => {
    const res = await login({ email: sharedEmail.toUpperCase(), password: PASSWORD, tenantId: TENANT_A.tenantId });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.tenant.id, TENANT_A.tenantId);
    assert.equal(res.body.data.auth.user.id, userA);
    const token = res.body.data.auth.accessToken as string;

    const me = await api.as(token, TENANT_A.tenantId).call('GET', '/users/me');
    assert.equal(me.status, 200);
    // El token de la tienda A no sirve en la tienda B
    const cross = await api.as(token, TENANT_B.tenantId).call('GET', '/users/me');
    assert.equal(cross.status, 401);
  });

  it('L2: con el mismo correo en dos tiendas solo se consulta la elegida y no se devuelven coincidencias', async () => {
    const capture = captureQueries();
    let res;
    try {
      res = await login({ email: sharedEmail, password: PASSWORD, tenantId: TENANT_B.tenantId });
    } finally {
      capture.stop();
    }
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.tenant.id, TENANT_B.tenantId);
    assert.equal(res.body.data.auth.user.id, userB);
    assert.deepEqual(Object.keys(res.body.data).sort(), ['auth', 'tenant']);
    assert.equal(JSON.stringify(res.body).includes(TENANT_A.tenantId), false, 'la respuesta no menciona otras tiendas');

    const touched = new Set(capture.texts.flatMap((sql) => sql.match(/tenant_[a-f0-9]{32}|tenant_legacy/g) ?? []));
    assert.deepEqual([...touched], [TENANT_B.schemaName], `schemas consultados: ${[...touched].join(', ')}`);
  });

  it('L3: la cantidad de consultas no crece al haber más tiendas activas', async () => {
    const measure = async () => {
      const capture = captureQueries();
      try {
        const res = await login({ email: sharedEmail, password: PASSWORD, tenantId: TENANT_A.tenantId });
        assert.equal(res.status, 200, JSON.stringify(res.body));
      } finally {
        capture.stop();
      }
      return capture.texts.length;
    };

    const before = await measure();
    // 25 tiendas ACTIVE más (sin schema: si el login las recorriera, aparecerían en las consultas)
    const extra = Array.from({ length: 25 }, () => randomUUID());
    await withSql(async (c) => {
      for (const id of extra) {
        await c.query(
          `INSERT INTO public.tenants (id, slug, name, schema_name, status, updated_at) VALUES ($1,$2,$2,$3,'ACTIVE',now())`,
          [id, `extra-${id}`, `tenant_${id.replace(/-/g, '')}`],
        );
      }
    });
    try {
      const afterCount = await measure();
      assert.equal(afterCount, before, `consultas con 2 tiendas: ${before}, con 27: ${afterCount}`);
    } finally {
      await withSql((c) => c.query(`DELETE FROM public.tenants WHERE id = ANY($1::uuid[])`, [extra]));
    }
  });

  it('L4: contraseña incorrecta, usuario inexistente y cuenta bloqueada reciben la misma respuesta genérica', async () => {
    const email = `bloqueo-${randomUUID()}@test.local`;
    await createLoginUser(TENANT_A.schemaName, roleA, email);

    const wrong = await login({ email, password: 'otra-clave', tenantId: TENANT_A.tenantId });
    const missing = await login({ email: `nadie-${randomUUID()}@test.local`, password: 'otra-clave', tenantId: TENANT_A.tenantId });
    assert.equal(wrong.status, 401);
    assert.deepEqual(wrong.body, missing.body);

    // El bloqueo por intentos sigue activo (3 fallos), pero no se distingue de una contraseña incorrecta
    await login({ email, password: 'otra-clave', tenantId: TENANT_A.tenantId });
    const third = await login({ email, password: 'otra-clave', tenantId: TENANT_A.tenantId });
    assert.equal(third.status, 401);
    assert.deepEqual(third.body, missing.body);
    const lockedWithRightPassword = await login({ email, password: PASSWORD, tenantId: TENANT_A.tenantId });
    assert.equal(lockedWithRightPassword.status, 401);
    assert.deepEqual(lockedWithRightPassword.body, missing.body);
    const { rows } = await withSql<any>((c) => c.query(`SELECT "lockedUntil" FROM "${TENANT_A.schemaName}".users WHERE email=$1`, [email]));
    assert.ok(rows[0].lockedUntil && new Date(rows[0].lockedUntil) > new Date());
  });

  it('L5: tienda inválida, suspendida o distinta de la del usuario no permite el acceso', async () => {
    const generic = (await login({ email: `nadie-${randomUUID()}@test.local`, password: 'x', tenantId: TENANT_A.tenantId })).body;

    const unknown = await login({ email: sharedEmail, password: PASSWORD, tenantId: randomUUID() });
    assert.equal(unknown.status, 401);
    assert.deepEqual(unknown.body, generic);

    const suspendedId = randomUUID();
    await withSql((c) =>
      c.query(`INSERT INTO public.tenants (id, slug, name, schema_name, status, updated_at) VALUES ($1,$2,$2,$3,'SUSPENDED',now())`, [
        suspendedId,
        `susp-${suspendedId}`,
        `tenant_${suspendedId.replace(/-/g, '')}`,
      ]),
    );
    try {
      const suspended = await login({ email: sharedEmail, password: PASSWORD, tenantId: suspendedId });
      assert.equal(suspended.status, 401);
      assert.deepEqual(suspended.body, generic);
    } finally {
      await withSql((c) => c.query(`DELETE FROM public.tenants WHERE id=$1`, [suspendedId]));
    }

    // Usuario que solo existe en A intentando entrar por B
    const onlyA = `solo-a-${randomUUID()}@test.local`;
    await createLoginUser(TENANT_A.schemaName, roleA, onlyA);
    const other = await login({ email: onlyA, password: PASSWORD, tenantId: TENANT_B.tenantId });
    assert.equal(other.status, 401);
    assert.deepEqual(other.body, generic);

    // Sin tienda elegida no hay login (ni búsqueda en todas las tiendas)
    const noTenant = await login({ email: onlyA, password: PASSWORD });
    assert.equal(noTenant.status, 400);
  });

  it('L6: el administrador de NovaSoft entra a su panel con su propio JWT, separado del de tienda', async () => {
    const adminEmail = `admin-${randomUUID()}@novasoft.test`;
    const adminPassword = 'Admin-Plataforma-123';
    await withSql(async (c) =>
      c.query(
        `INSERT INTO public.platform_admins (id,email,password_hash,name,is_active,login_attempts,updated_at) VALUES ($1,$2,$3,'Admin',true,0,now())`,
        [randomUUID(), adminEmail, await bcrypt.hash(adminPassword, 4)],
      ),
    );

    const res = await api.call('POST', '/platform/auth/login', { body: { email: adminEmail.toUpperCase(), password: adminPassword } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const platformToken = res.body.data.accessToken as string;

    const me = await api.as(platformToken).call('GET', '/platform/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.data.email, adminEmail);
    assert.equal((await api.as(platformToken).call('GET', '/platform/tenants')).status, 200);

    // El JWT de plataforma no abre una tienda, y el de tienda no abre la plataforma
    assert.equal((await api.as(platformToken, TENANT_A.tenantId).call('GET', '/users/me')).status, 401);
    const tenantSession = await login({ email: sharedEmail, password: PASSWORD, tenantId: TENANT_A.tenantId });
    const tenantToken = tenantSession.body.data.auth.accessToken as string;
    assert.equal((await api.as(tenantToken).call('GET', '/platform/auth/me')).status, 401);

    // El login de tienda no emite sesiones de plataforma
    const viaTenant = await login({ email: adminEmail, password: adminPassword, tenantId: TENANT_A.tenantId });
    assert.equal(viaTenant.status, 401);
  });
});
