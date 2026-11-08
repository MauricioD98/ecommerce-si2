import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { Client } from 'pg';
import { clearFailpoints, setFailpoint } from '../../src/common/checkout/failpoints';
import { loadBackupKeyring } from '../../src/modules/backups/backup-config';
import { decodeBackup, encodeBackup, readHeader, sha256Hex, tableHash } from '../../src/modules/backups/backup-format';
import { BackupsService } from '../../src/modules/backups/backups.service';
import { acceptanceDatabaseUrl } from './support/env';
import { TENANT_A, TENANT_B, bootApp, createProduct, queryRows, seedTenant, spawnReplica, withSql } from './support/world';

// Copias de seguridad y restauración (src/modules/backups). Base local desechable; ningún servicio externo.
const PLATFORM_KEY = 'acceptance-platform-key-0123456789abcdef';
const PASSWORD = 'Clave-Respaldo-123';
const QR_BYTES = Buffer.from('89504e470d0a1a0a-qr-imagen-de-prueba', 'utf8');
const PROOF_BYTES = Buffer.from('ffd8ffe0-comprobante-de-pago', 'utf8');
const LOGO = 'data:image/png;base64,' + Buffer.from('logo-de-la-tienda').toString('base64');

interface StoreFixture {
  schema: string;
  tenantId: string;
  adminId: string;
  adminEmail: string;
  clientRole: string;
  customerId: string;
  deletedLaterId: string;
  productId: string;
  productName: string;
  orderId: string;
  token: string;
  clientToken: string;
}

let app: INestApplication;
let base: string;
let service: BackupsService;
const stores: Record<'A' | 'B', StoreFixture> = {} as never;

function sign(userId: string, email: string, tenantId: string, roleName: string) {
  return app.get(JwtService, { strict: false }).sign(
    { sub: userId, email, role: { id: randomUUID(), name: roleName }, permissions: [], tenantId },
    { secret: process.env.JWT_SECRET, expiresIn: 3600 },
  );
}

async function call(method: string, path: string, opts: { tenantId?: string; token?: string; platform?: boolean; body?: unknown; form?: FormData } = {}) {
  const headers: Record<string, string> = {};
  if (opts.tenantId) headers['x-tenant-id'] = opts.tenantId;
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.platform) headers['x-platform-key'] = PLATFORM_KEY;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers,
    body: opts.form ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
  });
  const buffer = Buffer.from(await res.arrayBuffer());
  let body: any = null;
  try {
    body = JSON.parse(buffer.toString('utf8'));
  } catch {
    body = null;
  }
  return { status: res.status, body, buffer };
}

const store = (s: StoreFixture, method: string, path: string, extra: { body?: unknown; form?: FormData; token?: string } = {}) =>
  call(method, path, { tenantId: s.tenantId, token: extra.token ?? s.token, body: extra.body, form: extra.form });
const platform = (method: string, path: string, extra: { body?: unknown; form?: FormData } = {}) => call(method, path, { platform: true, ...extra });

async function settled(id: string) {
  await service.idle();
  const res = await platform('GET', `/platform/backups/${id}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data;
}

function uploadForm(file: Buffer, name = 'copia.sfbk') {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(file)]), name);
  return form;
}

// Huella por tabla de un schema completo: si no cambia, ninguna fila de esa tienda cambió
async function fingerprint(schema: string): Promise<Record<string, string>> {
  const tables = await queryRows<{ t: string }>(
    `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY 1`,
    [schema],
  );
  const out: Record<string, string> = {};
  for (const { t } of tables) {
    const [{ h }] = await queryRows<{ h: string }>(`SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM "${schema}"."${t}" x`);
    out[t] = h;
  }
  return out;
}

async function seedStore(label: 'A' | 'B', tenant: { tenantId: string; schemaName: string }): Promise<StoreFixture> {
  const fx = await seedTenant(tenant.schemaName);
  const s = `"${tenant.schemaName}"`;
  const productName = `Vestido-${label}-${randomUUID().slice(0, 6)}`;
  const productId = await createProduct(tenant.schemaName, fx, { [fx.branchA]: { M: 5 } });
  const adminId = randomUUID();
  const adminEmail = `dueno-${label.toLowerCase()}-${adminId.slice(0, 6)}@test.local`;
  const customerId = randomUUID();
  const deletedLaterId = randomUUID();
  const orderId = randomUUID();
  const hash = await bcrypt.hash(PASSWORD, 4);
  await withSql(async (c) => {
    await c.query(`UPDATE ${s}.products SET name = $2 WHERE id = $1`, [productId, productName]);
    const role = await c.query(`SELECT id FROM ${s}.roles WHERE name = 'Super Admin'`);
    const roleId = role.rows[0]?.id ?? randomUUID();
    if (!role.rows[0]) await c.query(`INSERT INTO ${s}.roles (id, name, permissions, "updatedAt") VALUES ($1, 'Super Admin', '{}', now())`, [roleId]);
    await c.query(`DELETE FROM ${s}.users WHERE "roleId" = $1`, [roleId]);
    await c.query(`INSERT INTO ${s}.users (id, email, password, "roleId", "refreshToken", "updatedAt") VALUES ($1, $2, $3, $4, 'sesion-vieja-admin', now())`, [
      adminId,
      adminEmail,
      hash,
      roleId,
    ]);
    for (const [id, token] of [
      [customerId, 'sesion-vieja-cliente'],
      [deletedLaterId, 'sesion-vieja-borrado'],
    ]) {
      await c.query(
        `INSERT INTO ${s}.users (id, email, password, "roleId", "refreshToken", "resetPasswordOtp", "updatedAt") VALUES ($1, $2, $3, $4, $5, '123456', now())`,
        [id, `${id}@test.local`, hash, fx.roleId, token],
      );
    }
    await c.query(
      `INSERT INTO ${s}.orders (id, "orderNumber", "totalAmount", "userId", status, source, "paymentExpiresAt", "updatedAt")
       VALUES ($1, $2, 100, $3, 'PENDIENTE', 'WEB', now() - interval '1 hour', now())`,
      [orderId, `ORD-${label}-${orderId.slice(0, 6)}`, customerId],
    );
    await c.query(`INSERT INTO ${s}.payment_proofs (id, "orderId", method, image, "updatedAt") VALUES ($1, $2, 'BANK_QR', $3, now())`, [randomUUID(), orderId, PROOF_BYTES]);
    await c.query(
      `INSERT INTO ${s}.payment_settings (id, "qrEnabled", "qrImage", "qrImageType", "updatedAt") VALUES ('default', true, $1, 'image/png', now())
       ON CONFLICT (id) DO UPDATE SET "qrImage" = EXCLUDED."qrImage", "qrEnabled" = true`,
      [QR_BYTES],
    );
    await c.query(
      `INSERT INTO ${s}.store_appearance (id, "logoUrl", "updatedAt") VALUES ('default', $1, now()) ON CONFLICT (id) DO UPDATE SET "logoUrl" = EXCLUDED."logoUrl"`,
      [LOGO],
    );
    await c.query(`INSERT INTO ${s}.outbox_events (id, type, "dedupeKey", payload) VALUES ($1, 'ORDER_CONFIRMATION_EMAIL', $2, '{}')`, [randomUUID(), `mail-${orderId}`]);
  });
  return {
    schema: tenant.schemaName,
    tenantId: tenant.tenantId,
    adminId,
    adminEmail,
    clientRole: fx.roleId,
    customerId,
    deletedLaterId,
    productId,
    productName,
    orderId,
    token: sign(adminId, adminEmail, tenant.tenantId, 'Super Admin'),
    clientToken: sign(customerId, `${customerId}@test.local`, tenant.tenantId, 'CLIENTE'),
  };
}

describe('Copias de seguridad y restauración', () => {
  let backupA: any;
  let fileA: Buffer;

  before(async () => {
    process.env.PLATFORM_ADMIN_KEY = PLATFORM_KEY;
    app = await bootApp();
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    service = app.get(BackupsService);
    await withSql(async (c) => {
      await c.query(`DELETE FROM public.backup_jobs`);
      await c.query(
        `INSERT INTO public.platform_admins (id, email, password_hash, login_attempts, updated_at) VALUES ($1, $2, 'hash-de-la-copia', 2, now())`,
        [randomUUID(), `respaldo-${randomUUID().slice(0, 6)}@novasoft.test`],
      );
    });
    stores.A = await seedStore('A', TENANT_A);
    stores.B = await seedStore('B', TENANT_B);
  });
  after(async () => {
    clearFailpoints();
    await app.close();
    await rm(process.env.BACKUP_DIR!, { recursive: true, force: true });
    // Las tiendas A/B son compartidas con las demás suites (p. ej. segmentación cuenta TODOS los pedidos
    // pendientes de A): se borran los pedidos sembrados aquí (cascada: comprobantes, pagos, ítems)
    await withSql(async (c) => {
      for (const s of Object.values(stores)) {
        await c.query(`DELETE FROM "${s.schema}".orders WHERE "orderNumber" LIKE 'ORD-A-%' OR "orderNumber" LIKE 'ORD-B-%'`);
      }
    });
  });

  it('R01: el dueño respalda SU tienda; la copia está cifrada y no trae otra tienda, sesiones ni control', async () => {
    const res = await store(stores.A, 'POST', '/backups');
    assert.equal(res.status, 202, JSON.stringify(res.body));
    assert.equal(res.body.data.status, 'PREPARING');
    backupA = await settled(res.body.data.id);
    assert.equal(backupA.status, 'AVAILABLE', JSON.stringify(backupA));
    assert.equal(backupA.scope, 'TENANT');
    assert.equal(backupA.tenantId, TENANT_A.tenantId);
    assert.ok(backupA.sizeBytes > 0 && /^[a-f0-9]{64}$/.test(backupA.sha256));
    assert.ok(backupA.summary.excluded.some((x: any) => x.id === 'sessions'));

    const dl = await store(stores.A, 'GET', `/backups/${backupA.id}/download`);
    assert.equal(dl.status, 200);
    fileA = dl.buffer;
    assert.equal(sha256Hex(fileA), backupA.sha256);
    assert.equal(fileA.subarray(0, 4).toString(), 'SFBK');
    // Cifrado: ni el nombre del producto ni el correo aparecen en claro
    assert.equal(fileA.includes(Buffer.from(stores.A.productName)), false);
    assert.equal(fileA.includes(Buffer.from(stores.A.adminEmail)), false);

    const { payload } = decodeBackup(fileA, loadBackupKeyring());
    const text = JSON.stringify(payload);
    assert.ok(text.includes(stores.A.productName));
    assert.equal(text.includes(stores.B.productName), false, 'la copia de A no contiene datos de B');
    assert.equal(text.includes('sesion-vieja'), false, 'sin refresh tokens');
    assert.equal(text.includes('"123456"'), false, 'sin OTP');
    assert.equal(payload.control, undefined);
    assert.equal(text.includes('tenant_integrations'), false);
    assert.equal(text.includes('platform_admins'), false);
    assert.equal(payload.manifest.tenant!.id, TENANT_A.tenantId);
    assert.ok(payload.tenant!.migrations.length > 0);

    const list = await store(stores.A, 'GET', '/backups');
    assert.ok(list.body.data.some((j: any) => j.id === backupA.id));
  });

  it('R02: otra tienda no puede ver, descargar, restaurar ni usar la copia aunque manipule ids o rutas', async () => {
    const asB = (method: string, path: string, extra = {}) => store(stores.B, method, path, extra);
    assert.equal((await asB('GET', `/backups/${backupA.id}`)).status, 404);
    assert.equal((await asB('GET', `/backups/${backupA.id}/download`)).status, 404);
    assert.equal((await asB('GET', `/backups/${backupA.id}/preview`)).status, 404);
    assert.equal((await asB('POST', `/backups/${backupA.id}/restore`, { body: { confirmation: 'alpha', acknowledgeReplace: true } })).status, 404);
    assert.equal((await asB('DELETE', `/backups/${backupA.id}`)).status, 404);
    assert.equal((await asB('GET', '/backups')).body.data.some((j: any) => j.id === backupA.id), false);
    // Ruta manipulada (no es un UUID): rechazada antes de tocar el disco
    assert.equal((await asB('GET', `/backups/..%2F..%2Fetc%2Fpasswd/download`)).status, 400);
    // El archivo de A subido en B
    const up = await asB('POST', '/backups/upload', { form: uploadForm(fileA) });
    assert.equal(up.status, 403, JSON.stringify(up.body));
    // Token de A con la tienda B en el header
    assert.equal((await call('GET', `/backups/${backupA.id}`, { tenantId: TENANT_B.tenantId, token: stores.A.token })).status, 401);
  });

  it('R03: sin permiso: cliente 403, sin sesión 401, token de tienda en plataforma 401, plataforma sin llave 401', async () => {
    assert.equal((await store(stores.A, 'GET', '/backups', { token: stores.A.clientToken })).status, 403);
    assert.equal((await store(stores.A, 'POST', '/backups', { token: stores.A.clientToken })).status, 403);
    assert.equal((await call('GET', '/backups', { tenantId: TENANT_A.tenantId })).status, 401);
    assert.equal((await call('GET', '/platform/backups', { token: stores.A.token })).status, 401);
    assert.equal((await call('POST', '/platform/backups')).status, 401);
    // Un JWT con rol "Super Admin" de un usuario que en la base NO lo es: restaurar se vuelve a verificar
    const fake = sign(stores.A.customerId, `${stores.A.customerId}@test.local`, TENANT_A.tenantId, 'Super Admin');
    const res = await store(stores.A, 'POST', `/backups/${backupA.id}/restore`, { token: fake, body: { confirmation: 'alpha', acknowledgeReplace: true } });
    assert.equal(res.status, 403);
  });

  it('R04: restaurar A recupera sus datos y adjuntos, conserva credenciales actuales y no toca B ni el control', async () => {
    const s = `"${stores.A.schema}"`;
    const newAdminHash = await bcrypt.hash('Clave-Nueva-456', 4);
    const extraProduct = randomUUID();
    await withSql(async (c) => {
      await c.query(`UPDATE ${s}.products SET name = 'cambiado' WHERE id = $1`, [stores.A.productId]);
      await c.query(`INSERT INTO ${s}.products (id, name, sizes, price, stock, sku, "categoryId", "updatedAt")
                     SELECT $1, 'nuevo-despues-del-respaldo', sizes, price, 0, $2, "categoryId", now() FROM ${s}.products WHERE id = $3`, [extraProduct, `SKU-${extraProduct}`, stores.A.productId]);
      await c.query(`DELETE FROM ${s}.payment_proofs`);
      await c.query(`UPDATE ${s}.payment_settings SET "qrImage" = NULL`);
      await c.query(`UPDATE ${s}.users SET password = $2, "refreshToken" = 'sesion-actual-admin' WHERE id = $1`, [stores.A.adminId, newAdminHash]);
      await c.query(`UPDATE ${s}.users SET "refreshToken" = 'sesion-actual-cliente' WHERE id = $1`, [stores.A.customerId]);
      await c.query(`DELETE FROM ${s}.users WHERE id = $1`, [stores.A.deletedLaterId]);
    });
    const fpB = await fingerprint(stores.B.schema);
    const [controlBefore] = await queryRows(`SELECT md5(string_agg(t::text, '|' ORDER BY t::text)) h FROM public.tenants t`);

    const preview = await store(stores.A, 'GET', `/backups/${backupA.id}/preview`);
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(preview.body.data.tenant.id, TENANT_A.tenantId);
    assert.equal(preview.body.data.confirmationPhrase, 'alpha');
    assert.equal(preview.body.data.compatible, true, JSON.stringify(preview.body.data.problems));
    assert.ok(preview.body.data.excluded.length > 0 && preview.body.data.included.length > 0);
    assert.ok(preview.body.data.tables.find((t: any) => t.name === 'products'));

    const wrong = await store(stores.A, 'POST', `/backups/${backupA.id}/restore`, { body: { confirmation: 'beta', acknowledgeReplace: true } });
    assert.equal(wrong.status, 400);
    const noAck = await store(stores.A, 'POST', `/backups/${backupA.id}/restore`, { body: { confirmation: 'alpha', acknowledgeReplace: false } });
    assert.equal(noAck.status, 400);

    const res = await store(stores.A, 'POST', `/backups/${backupA.id}/restore`, { body: { confirmation: 'alpha', acknowledgeReplace: true } });
    assert.equal(res.status, 202, JSON.stringify(res.body));
    assert.equal(res.body.data.status, 'VALIDATING');
    const done = await settled(res.body.data.id);
    assert.equal(done.status, 'COMPLETED', JSON.stringify(done));
    assert.equal(done.result.actorPreserved, true);

    const [p] = await queryRows(`SELECT name FROM ${s}.products WHERE id = $1`, [stores.A.productId]);
    assert.equal(p.name, stores.A.productName);
    assert.equal((await queryRows(`SELECT 1 FROM ${s}.products WHERE id = $1`, [extraProduct])).length, 0);
    // Adjuntos guardados en la base: idénticos byte a byte
    const [proof] = await queryRows(`SELECT image FROM ${s}.payment_proofs WHERE "orderId" = $1`, [stores.A.orderId]);
    assert.ok(Buffer.from(proof.image).equals(PROOF_BYTES));
    const [settings] = await queryRows(`SELECT "qrImage" FROM ${s}.payment_settings WHERE id = 'default'`);
    assert.ok(Buffer.from(settings.qrImage).equals(QR_BYTES));
    const [look] = await queryRows(`SELECT "logoUrl" FROM ${s}.store_appearance WHERE id = 'default'`);
    assert.equal(look.logoUrl, LOGO);
    // Credenciales: las actuales se conservan; el borrado vuelve sin sesión; nadie recupera tokens viejos
    const users = await queryRows<{ id: string; password: string; refreshToken: string | null; resetPasswordOtp: string | null }>(
      `SELECT id, password, "refreshToken", "resetPasswordOtp" FROM ${s}.users`,
    );
    const byId = new Map(users.map((u) => [u.id, u]));
    assert.equal(byId.get(stores.A.adminId)!.password, newAdminHash);
    assert.equal(byId.get(stores.A.adminId)!.refreshToken, 'sesion-actual-admin');
    assert.equal(byId.get(stores.A.customerId)!.refreshToken, 'sesion-actual-cliente');
    const revived = byId.get(stores.A.deletedLaterId)!;
    assert.ok(revived, 'el usuario borrado vuelve desde la copia');
    assert.equal(revived.refreshToken, null);
    assert.equal(revived.resetPasswordOtp, null);
    assert.ok(await bcrypt.compare(PASSWORD, revived.password));
    assert.equal(users.some((u) => String(u.refreshToken).startsWith('sesion-vieja')), false);
    // Efectos externos retenidos
    const [outbox] = await queryRows(`SELECT status, "lastError" FROM ${s}.outbox_events WHERE "dedupeKey" = $1`, [`mail-${stores.A.orderId}`]);
    assert.equal(outbox.status, 'DEAD');
    const [order] = await queryRows(`SELECT "reconciliationStatus", "paymentExpiresAt" > now() AS later FROM ${s}.orders WHERE id = $1`, [stores.A.orderId]);
    assert.equal(order.reconciliationStatus, 'RESTORED_FROM_BACKUP');
    assert.equal(order.later, true);
    assert.equal((await queryRows(`SELECT 1 FROM ${s}.operational_issues WHERE type = 'BACKUP_RESTORED'`)).length, 1);
    // La otra tienda y el plano de control, intactos
    assert.deepEqual(await fingerprint(stores.B.schema), fpB);
    const [controlAfter] = await queryRows(`SELECT md5(string_agg(t::text, '|' ORDER BY t::text)) h FROM public.tenants t`);
    assert.equal(controlAfter.h, controlBefore.h);
    // La sesión del dueño sigue sirviendo para terminar la recuperación
    assert.equal((await store(stores.A, 'GET', '/backups')).status, 200);
  });

  it('R05: copias corruptas, manipuladas, de otra clave o de otra versión se rechazan', async () => {
    const flip = (buf: Buffer, at: number) => {
      const copy = Buffer.from(buf);
      copy[at] ^= 0x01;
      return copy;
    };
    const upload = (file: Buffer) => store(stores.A, 'POST', '/backups/upload', { form: uploadForm(file) });
    // Un byte del contenido cifrado
    let res = await upload(flip(fileA, fileA.length - 40));
    assert.equal(res.status, 400);
    assert.match(res.body.message, /alterada|dañada|clave/);
    // El encabezado (que va autenticado como AAD): cambiar la fecha
    const { bodyStart } = readHeader(fileA);
    res = await upload(flip(fileA, bodyStart - 5));
    assert.equal(res.status, 400);
    // Basura y archivo truncado
    assert.equal((await upload(Buffer.from('DROP SCHEMA public CASCADE;'))).status, 400);
    assert.equal((await upload(fileA.subarray(0, 100))).status, 400);
    // Generada con otra clave (otro servidor): origen no verificable
    const { payload } = decodeBackup(fileA, loadBackupKeyring());
    const foreign = encodeBackup(payload, { activeVersion: 1, keys: new Map([[1, Buffer.alloc(32, 9)]]) }).file;
    assert.equal((await upload(foreign)).status, 400);
    // Sin archivo
    assert.equal((await store(stores.A, 'POST', '/backups/upload', { form: new FormData() })).status, 400);

    // Archivo alterado EN EL SERVIDOR después de generarse: no se descarga ni se restaura
    const job = await store(stores.A, 'POST', '/backups');
    const generated = await settled(job.body.data.id);
    const { writeFile, readFile } = await import('node:fs/promises');
    const path = require('node:path').join(process.env.BACKUP_DIR!, `${generated.id}.sfbk`);
    const original = await readFile(path);
    await writeFile(path, flip(original, original.length - 20));
    assert.equal((await store(stores.A, 'GET', `/backups/${generated.id}/download`)).status, 400);
    assert.equal((await store(stores.A, 'GET', `/backups/${generated.id}/preview`)).status, 400);
    await writeFile(path, original);

    // Válida y de esta tienda, pero de otra versión de la app (migraciones distintas): incompatible
    const older = JSON.parse(JSON.stringify(payload));
    older.manifest.backupId = randomUUID();
    older.tenant.migrations = older.tenant.migrations.slice(0, -1);
    const incompatible = encodeBackup(older, loadBackupKeyring()).file;
    const up = await upload(incompatible);
    assert.equal(up.status, 201, JSON.stringify(up.body));
    const prev = await store(stores.A, 'GET', `/backups/${up.body.data.id}/preview`);
    assert.equal(prev.body.data.compatible, false);
    assert.equal(prev.body.data.problems[0].code, 'BACKUP_INCOMPATIBLE_VERSION');
    const fp = await fingerprint(stores.A.schema);
    const restore = await store(stores.A, 'POST', `/backups/${up.body.data.id}/restore`, { body: { confirmation: 'alpha', acknowledgeReplace: true } });
    const failed = await settled(restore.body.data.id);
    assert.equal(failed.status, 'FAILED');
    assert.equal(failed.errorCode, 'BACKUP_INCOMPATIBLE_VERSION');
    assert.match(failed.errorDetail, /Migraciones distintas/, 'la plataforma ve el detalle técnico');
    const asStore = await store(stores.A, 'GET', `/backups/${failed.id}`);
    assert.equal(asStore.body.data.errorCode, 'BACKUP_INCOMPATIBLE_VERSION');
    assert.equal(asStore.body.data.errorDetail, null, 'la tienda no ve el detalle técnico');
    assert.deepEqual(await fingerprint(stores.A.schema), fp);

    // Filas que violan una restricción (FK hacia un rol inexistente) con hash recalculado: falla la validación aislada
    const broken = JSON.parse(JSON.stringify(payload));
    broken.manifest.backupId = randomUUID();
    broken.tenant.data.users[0].roleId = randomUUID();
    const usersTable = broken.tenant.tables.find((t: any) => t.name === 'users');
    usersTable.sha256 = tableHash(broken.tenant.data.users);
    const up2 = await upload(encodeBackup(broken, loadBackupKeyring()).file);
    const r2 = await store(stores.A, 'POST', `/backups/${up2.body.data.id}/restore`, { body: { confirmation: 'alpha', acknowledgeReplace: true } });
    const f2 = await settled(r2.body.data.id);
    assert.equal(f2.status, 'FAILED');
    assert.equal(f2.errorCode, 'BACKUP_VALIDATION_FAILED');
    assert.deepEqual(await fingerprint(stores.A.schema), fp);
  });

  it('R06: una falla o una caída a mitad no deja una restauración parcial presentada como exitosa', async () => {
    const s = `"${stores.A.schema}"`;
    await withSql((c) => c.query(`UPDATE ${s}.products SET name = 'estado-antes-de-la-falla' WHERE id = $1`, [stores.A.productId]));
    const fp = await fingerprint(stores.A.schema);
    setFailpoint('backup.restore.beforeCommit', () => {
      throw new Error('caída simulada antes del COMMIT');
    });
    try {
      const res = await store(stores.A, 'POST', `/backups/${backupA.id}/restore`, { body: { confirmation: 'alpha', acknowledgeReplace: true } });
      const job = await settled(res.body.data.id);
      assert.equal(job.status, 'FAILED');
      assert.equal(job.errorCode, 'BACKUP_RESTORE_FAILED');
    } finally {
      clearFailpoints();
    }
    assert.deepEqual(await fingerprint(stores.A.schema), fp, 'ROLLBACK completo: ni una fila cambió');

    // Proceso caído con un trabajo activo: al arrancar queda FAILED/BACKUP_INTERRUPTED y libera el bloqueo
    const ghost = randomUUID();
    await withSql((c) =>
      c.query(
        `INSERT INTO public.backup_jobs (id, kind, scope, tenant_id, status, requested_by_type, lock_key, started_at)
         VALUES ($1, 'RESTORE', 'TENANT', $2, 'RESTORING', 'TENANT_USER', $3, now())`,
        [ghost, TENANT_A.tenantId, `tenant:${TENANT_A.tenantId}`],
      ),
    );
    // Mientras está activo, nada incompatible arranca (misma tienda ni plataforma); la otra tienda sí
    assert.equal((await store(stores.A, 'POST', '/backups')).status, 409);
    assert.equal((await platform('POST', '/platform/backups')).status, 409);
    await service.recoverInterrupted();
    const [row] = await queryRows(`SELECT status, error_code, lock_key FROM public.backup_jobs WHERE id = $1`, [ghost]);
    assert.deepEqual([row.status, row.error_code, row.lock_key], ['FAILED', 'BACKUP_INTERRUPTED', null]);
    const again = await store(stores.A, 'POST', '/backups');
    assert.equal(again.status, 202);
    await service.idle();
    await withSql((c) => c.query(`UPDATE ${s}.products SET name = $2 WHERE id = $1`, [stores.A.productId, stores.A.productName]));
  });

  let platformBackup: any;
  let platformFile: Buffer;

  it('R07: el administrador del SaaS respalda el control y todas las tiendas, y gestiona respaldos de una tienda', async () => {
    const res = await platform('POST', '/platform/backups');
    assert.equal(res.status, 202, JSON.stringify(res.body));
    platformBackup = await settled(res.body.data.id);
    assert.equal(platformBackup.status, 'AVAILABLE', JSON.stringify(platformBackup));
    assert.equal(platformBackup.scope, 'PLATFORM');
    const ids = platformBackup.summary.tenants.map((t: any) => t.id);
    assert.ok(ids.includes(TENANT_A.tenantId) && ids.includes(TENANT_B.tenantId));
    assert.ok(platformBackup.summary.tenants.every((t: any) => t.schemaIncluded));

    const dl = await platform('GET', `/platform/backups/${platformBackup.id}/download`);
    assert.equal(dl.status, 200);
    platformFile = dl.buffer;
    const { payload } = decodeBackup(platformFile, loadBackupKeyring());
    assert.ok(payload.control!.data.tenants.length >= 2);
    assert.equal(payload.control!.data.backup_jobs, undefined);
    assert.equal(payload.control!.data.mobile_app_attest_keys, undefined);
    assert.ok(JSON.stringify(payload.tenants![TENANT_A.tenantId]).includes(stores.A.productName));
    assert.ok(JSON.stringify(payload.tenants![TENANT_B.tenantId]).includes(stores.B.productName));
    assert.equal(JSON.stringify(payload).includes('sesion-actual'), false, 'sin refresh tokens');

    // Una copia de plataforma no es visible para ninguna tienda
    assert.equal((await store(stores.A, 'GET', `/backups/${platformBackup.id}`)).status, 404);

    // Respaldo de una tienda concreta desde la plataforma: lo ve esa tienda, no la otra
    const forB = await platform('POST', `/platform/backups/tenants/${TENANT_B.tenantId}`);
    assert.equal(forB.status, 202);
    const jobB = await settled(forB.body.data.id);
    assert.equal(jobB.status, 'AVAILABLE');
    assert.equal((await store(stores.B, 'GET', `/backups/${jobB.id}`)).status, 200);
    assert.equal((await store(stores.A, 'GET', `/backups/${jobB.id}`)).status, 404);
    assert.equal((await platform('POST', `/platform/backups/tenants/${randomUUID()}`)).status, 404);
    const listed = await platform('GET', `/platform/backups?tenantId=${TENANT_B.tenantId}`);
    assert.ok(listed.body.data.every((j: any) => j.tenantId === TENANT_B.tenantId));
  });

  it('R08: restaurar la plataforma recupera las dos tiendas y el control sin quitar accesos administrativos', async () => {
    const adminEmail = `admin-${randomUUID().slice(0, 6)}@novasoft.test`;
    await withSql(async (c) => {
      await c.query(`UPDATE "${stores.A.schema}".products SET name = 'roto-A' WHERE id = $1`, [stores.A.productId]);
      await c.query(`UPDATE "${stores.B.schema}".products SET name = 'roto-B' WHERE id = $1`, [stores.B.productId]);
      await c.query(`UPDATE public.tenants SET name = 'nombre-cambiado' WHERE id = $1`, [TENANT_A.tenantId]);
      await c.query(`INSERT INTO public.platform_admins (id, email, password_hash, updated_at) VALUES ($1, $2, 'hash-actual', now())`, [randomUUID(), adminEmail]);
    });
    const preview = await platform('GET', `/platform/backups/${platformBackup.id}/preview`);
    assert.equal(preview.status, 200);
    assert.equal(preview.body.data.compatible, true, JSON.stringify(preview.body.data.problems));
    assert.equal(preview.body.data.confirmationPhrase, 'RESTORE-PLATFORM');
    assert.equal((await platform('POST', `/platform/backups/${platformBackup.id}/restore`, { body: { confirmation: 'alpha', acknowledgeReplace: true } })).status, 400);

    const res = await platform('POST', `/platform/backups/${platformBackup.id}/restore`, { body: { confirmation: 'RESTORE-PLATFORM', acknowledgeReplace: true } });
    assert.equal(res.status, 202, JSON.stringify(res.body));
    const done = await settled(res.body.data.id);
    assert.equal(done.status, 'COMPLETED', JSON.stringify(done));
    const [a] = await queryRows(`SELECT name FROM "${stores.A.schema}".products WHERE id = $1`, [stores.A.productId]);
    const [b] = await queryRows(`SELECT name FROM "${stores.B.schema}".products WHERE id = $1`, [stores.B.productId]);
    assert.equal(a.name, stores.A.productName);
    assert.equal(b.name, stores.B.productName);
    const [t] = await queryRows(`SELECT name FROM public.tenants WHERE id = $1`, [TENANT_A.tenantId]);
    assert.equal(t.name, 'alpha');
    // El administrador creado después de la copia sigue activo con su contraseña
    const [admin] = await queryRows(`SELECT is_active, password_hash FROM public.platform_admins WHERE email = $1`, [adminEmail]);
    assert.deepEqual([admin.is_active, admin.password_hash], [true, 'hash-actual']);
    // El historial de respaldos no se reemplazó
    assert.equal((await queryRows(`SELECT 1 FROM public.backup_jobs WHERE id = $1`, [platformBackup.id])).length, 1);
  });

  it('R09: la copia de plataforma se restaura en un entorno aislado (otra base) con lo que dice contener', async () => {
    const url = new URL(acceptanceDatabaseUrl());
    const isolatedName = `${url.pathname.slice(1)}_restore`;
    const admin = new Client({ connectionString: url.toString() });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${isolatedName}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${isolatedName}"`);
    await admin.end();
    const isolated = new URL(url.toString());
    isolated.pathname = `/${isolatedName}`;

    // Solo el plano de control migrado (incluye backup_jobs); las tiendas las crea la restauración
    const { execFileSync } = await import('node:child_process');
    const { join } = await import('node:path');
    const cwd = join(__dirname, '..', '..', '..');
    execFileSync(process.execPath, [join(cwd, 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy', '--config', 'prisma.control.config.ts'], {
      cwd,
      env: { ...process.env, DATABASE_URL: isolated.toString(), DIRECT_URL: isolated.toString() },
      stdio: 'pipe',
    });

    const replica = await spawnReplica(39_000 + Math.floor(Math.random() * 1000), {
      DATABASE_URL: isolated.toString(),
      DIRECT_URL: isolated.toString(),
      BACKUP_DIR: `${process.env.BACKUP_DIR}-isolated`,
      PLATFORM_ADMIN_KEY: PLATFORM_KEY,
    });
    try {
      const call2 = async (method: string, path: string, init: { body?: unknown; form?: FormData } = {}) => {
        const res = await fetch(`${replica.url}/api/v1${path}`, {
          method,
          headers: { 'x-platform-key': PLATFORM_KEY, ...(init.body ? { 'content-type': 'application/json' } : {}) },
          body: init.form ?? (init.body ? JSON.stringify(init.body) : undefined),
        });
        return { status: res.status, body: await res.json() };
      };
      const up = await call2('POST', '/platform/backups/upload', { form: uploadForm(platformFile) });
      assert.equal(up.status, 201, JSON.stringify(up.body));
      const prev = await call2('GET', `/platform/backups/${up.body.data.id}/preview`);
      assert.equal(prev.body.data.tenants.every((t: any) => t.existsNow === false), true);
      const res = await call2('POST', `/platform/backups/${up.body.data.id}/restore`, { body: { confirmation: 'RESTORE-PLATFORM', acknowledgeReplace: true } });
      assert.equal(res.status, 202);
      let job = res.body.data;
      for (let i = 0; i < 600 && ['VALIDATING', 'RESTORING'].includes(job.status); i += 1) {
        await new Promise((r) => setTimeout(r, 500));
        job = (await call2('GET', `/platform/backups/${job.id}`)).body.data;
      }
      assert.equal(job.status, 'COMPLETED', JSON.stringify(job));
      assert.ok(job.result.createdSchemas.includes(TENANT_A.schemaName));

      // Comparar fila por fila lo que dice la copia contra la base aislada
      const { payload } = decodeBackup(platformFile, loadBackupKeyring());
      const c = new Client({ connectionString: isolated.toString() });
      await c.connect();
      try {
        for (const tenantId of [TENANT_A.tenantId, TENANT_B.tenantId]) {
          const snapshot = payload.tenants![tenantId];
          const schema = tenantId === TENANT_A.tenantId ? TENANT_A.schemaName : TENANT_B.schemaName;
          for (const table of snapshot.tables) {
            const { rows } = await c.query(`SELECT count(*)::int n FROM "${schema}"."${table.name}"`);
            // + la anomalía BACKUP_RESTORED que deja la restauración para conciliar pagos
            assert.equal(rows[0].n, table.rows + (table.name === 'operational_issues' ? 1 : 0), `${schema}.${table.name}`);
          }
        }
        const { rows: proofs } = await c.query(`SELECT image FROM "${TENANT_B.schemaName}".payment_proofs WHERE "orderId" = $1`, [stores.B.orderId]);
        assert.ok(Buffer.from(proofs[0].image).equals(PROOF_BYTES), 'el comprobante (adjunto) se recupera');
        const { rows: tenants } = await c.query(`SELECT slug, status FROM public.tenants ORDER BY slug`);
        assert.deepEqual(tenants.map((t) => t.slug).filter((s) => ['alpha', 'beta'].includes(s)), ['alpha', 'beta']);
        // Administradores de la copia: vuelven desactivados (se reactivan con npm run platform:admin)
        const { rows: admins } = await c.query(`SELECT bool_or(is_active) AS any_active, count(*)::int n FROM public.platform_admins`);
        assert.ok(admins[0].n >= 1);
        assert.equal(admins[0].any_active, false);
        const { rows: sessions } = await c.query(`SELECT count(*)::int n FROM "${TENANT_A.schemaName}".users WHERE "refreshToken" IS NOT NULL`);
        assert.equal(sessions[0].n, 0, 'ninguna sesión vieja reactivada');
      } finally {
        await c.end();
      }
    } finally {
      await replica.stop();
      await rm(`${process.env.BACKUP_DIR}-isolated`, { recursive: true, force: true });
      const cleanup = new Client({ connectionString: url.toString() });
      await cleanup.connect();
      await cleanup.query(`DROP DATABASE IF EXISTS "${isolatedName}" WITH (FORCE)`);
      await cleanup.end();
    }
  });

  it('R10: borrar un respaldo solo lo hace su dueño y elimina el archivo', async () => {
    const res = await store(stores.B, 'POST', '/backups');
    const job = await settled(res.body.data.id);
    assert.equal((await store(stores.A, 'DELETE', `/backups/${job.id}`)).status, 404);
    assert.equal((await store(stores.B, 'DELETE', `/backups/${job.id}`)).status, 200);
    const { existsSync } = await import('node:fs');
    assert.equal(existsSync(require('node:path').join(process.env.BACKUP_DIR!, `${job.id}.sfbk`)), false);
    assert.equal((await store(stores.B, 'GET', `/backups/${job.id}`)).status, 404);
  });
});
