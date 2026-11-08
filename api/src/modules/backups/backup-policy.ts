import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { reconciliationHoldMs } from '../../common/checkout/checkout-policy';
import type { ComponentInfo, SchemaSnapshot } from './backup-format';
import { BackupSqlError, countRows, insertRows, listTables, qi, qs, type RowTransform } from './backup-sql';

// ------------------------------------------------------------------------------------------------
// Qué entra en cada respaldo y cómo se aplica. Fuente de verdad de la documentación (docs/backups.md).
// ------------------------------------------------------------------------------------------------

/** Nunca salen del servidor: sesiones, códigos de recuperación y bloqueos. Las contraseñas sí (bcrypt). */
export const TENANT_EXPORT_TRANSFORMS: Record<string, RowTransform> = {
  users: (row) => ({
    ...row,
    refreshToken: null,
    resetPasswordOtp: null,
    resetPasswordExpires: null,
    resetPasswordAttempts: 0,
    loginAttempts: 0,
    lockedUntil: null,
  }),
};

// Plano de control: tablas que NO se respaldan.
//  - backup_jobs: es el registro de la propia recuperación (reemplazarlo borraría la restauración en curso)
//  - mobile_attestation_challenges: desafíos de un solo uso que vencen en minutos
//  - mobile_app_attest_keys: su sign_count solo puede crecer (anti-repetición); restaurar un valor viejo
//    reabriría aserciones ya usadas. Las instalaciones de iOS generan una clave nueva si falta.
export const CONTROL_EXCLUDED_TABLES = ['backup_jobs', 'mobile_attestation_challenges', 'mobile_app_attest_keys'] as const;

export const CONTROL_EXPORT_TRANSFORMS: Record<string, RowTransform> = {
  platform_admins: (row) => ({ ...row, login_attempts: 0, locked_until: null }),
  // Se vacía al completar el alta; un alta pendiente no se puede retomar desde una copia
  tenant_signups: (row) => ({ ...row, password_hash: '' }),
};

export const TENANT_INCLUDED: ComponentInfo[] = [
  { id: 'catalog', detail: 'products, categories, collections, _CollectionToProduct, product_inventories' },
  { id: 'branches', detail: 'branches' },
  { id: 'orders', detail: 'orders, order_items, payments, payment_proofs (con imagen), returns, return_items' },
  { id: 'checkout', detail: 'carts, cart_items, stock_reservations, inventory_movements, checkout_attempts, payment_attempts, payment_compensations, outbox_events, operational_issues' },
  { id: 'users', detail: 'users (clientes y empleados, contraseñas bcrypt), roles, user_addresses, dashboard_layouts, push_subscriptions' },
  { id: 'settings', detail: 'payment_settings (con imagen del QR), store_appearance (logo, favicon y fondo como data URL)' },
  { id: 'sync', detail: 'profile_sync_receipts, offline_sync_receipts' },
];

export const TENANT_EXCLUDED: ComponentInfo[] = [
  { id: 'sessions', detail: 'refresh tokens, códigos OTP de recuperación y bloqueos de login' },
  { id: 'platformControl', detail: 'registro de la tienda en la plataforma: plan, estado, dominio, Stripe Connect, suscripción' },
  { id: 'integrations', detail: 'claves cifradas de Decart y Web Push (las gestiona la plataforma)' },
  { id: 'externalImages', detail: 'archivos de imageUrl de productos y categorías: son URLs externas, solo se guarda el texto' },
  { id: 'aiModels', detail: 'modelos y salidas de pronóstico y segmentación (IA/AS, IA/ANS): se regeneran entrenando' },
  { id: 'reportingViews', detail: 'vistas <schema>_reporting y rol reports_*: las crean las migraciones' },
  { id: 'externalServices', detail: 'Stripe, correos enviados, notificaciones push entregadas' },
];

export const PLATFORM_INCLUDED: ComponentInfo[] = [
  { id: 'control', detail: 'tenants, tenant_signups, tenant_integrations (cifradas), tenant_credentials, platform_admins, provider_event_inbox' },
  { id: 'allTenants', detail: 'el schema completo de cada tienda registrada (mismo contenido que un respaldo de tienda)' },
];

export const PLATFORM_EXCLUDED: ComponentInfo[] = [
  { id: 'sessions', detail: 'refresh tokens, OTP y bloqueos de usuarios y administradores' },
  { id: 'backupJobs', detail: 'historial de respaldos (backup_jobs)' },
  { id: 'mobileAttestation', detail: 'desafíos y claves App Attest de la app móvil' },
  { id: 'secretsKeys', detail: 'TENANT_SECRETS_KEYS, BACKUP_ENCRYPTION_KEYS, JWT_SECRET, claves de Stripe y demás variables de entorno' },
  { id: 'externalImages', detail: 'imágenes externas de productos y categorías (URLs)' },
  { id: 'aiModels', detail: 'modelos y salidas de IA en disco' },
  { id: 'databaseRoles', detail: 'roles de PostgreSQL (los recrean las migraciones de cada tienda)' },
  { id: 'externalServices', detail: 'Stripe (cobros, suscripciones, cuentas Connect), correos y push' },
];

export const RESTORE_NOTE = 'Restaurado desde un respaldo: no se reenvía automáticamente';

export interface ActorSnapshot {
  id: string;
}

export interface TenantRestoreStats {
  tables: number;
  rows: number;
  credentialsKept: number;
  usersFromBackup: number;
  actorPreserved: boolean;
  outboxHeld: number;
  compensationsHeld: number;
  ordersHeld: number;
}

/**
 * Reemplaza los datos de UNA tienda por los de la copia, dentro de la transacción del llamador.
 * Toca solo las tablas de ese schema (TRUNCATE con lista explícita, sin CASCADE ni nada global).
 *
 * Credenciales y sesiones:
 *  - Usuario que existe hoy (mismo id): conserva su contraseña y su refresh token ACTUALES; no se pisan.
 *  - Usuario que solo está en la copia: vuelve con la contraseña (bcrypt) que tenía y sin sesión.
 *  - Ningún refresh token, OTP ni bloqueo sale de la copia (se exportan vacíos).
 *  - Quien restaura (actor) mantiene su usuario y su rol para poder terminar la recuperación.
 * Efectos externos: outbox pendiente → DEAD, reembolsos pendientes → MANUAL_REVIEW, pedidos web
 * pendientes con plazo extendido y marcados RESTORED_FROM_BACKUP (el cron no los vence ni consulta
 * Stripe hasta que pase el plazo de conciliación). Nada se envía ni se cobra por restaurar.
 */
export async function applyTenantSnapshot(
  c: PoolClient,
  schema: string,
  snapshot: SchemaSnapshot,
  options: { actor?: ActorSnapshot; backupId: string },
): Promise<TenantRestoreStats> {
  const s = qs(schema);
  const current = await c.query<{ id: string; password: string; refreshToken: string | null }>(
    `SELECT id, password, "refreshToken" FROM ${s}.users`,
  );
  let actorRow: Record<string, unknown> | null = null;
  let actorRole: Record<string, unknown> | null = null;
  if (options.actor) {
    const a = await c.query<{ u: Record<string, unknown> }>(`SELECT to_jsonb(u) AS u FROM ${s}.users u WHERE id = $1`, [options.actor.id]);
    actorRow = a.rows[0]?.u ?? null;
    if (actorRow) {
      const r = await c.query<{ r: Record<string, unknown> }>(`SELECT to_jsonb(r) AS r FROM ${s}.roles r WHERE id = $1`, [actorRow.roleId]);
      actorRole = r.rows[0]?.r ?? null;
    }
  }

  const tables = await listTables(c, schema);
  await c.query(`TRUNCATE TABLE ${tables.map((t) => `${s}.${qi(t.name)}`).join(', ')}`);

  let rows = 0;
  for (const table of snapshot.tables) {
    rows += await insertRows(c, schema, table.name, table.columns, snapshot.data[table.name]);
  }

  const kept = await c.query(
    `UPDATE ${s}.users u SET password = cur.password, "refreshToken" = cur."refreshToken"
       FROM json_to_recordset($1::json) AS cur(id text, password text, "refreshToken" text) WHERE u.id = cur.id`,
    [JSON.stringify(current.rows)],
  );
  const usersInBackup = snapshot.data.users?.length ?? 0;
  const credentialsKept = kept.rowCount ?? 0;

  let actorPreserved = false;
  const extra: Record<string, number> = {};
  if (actorRow && actorRole) {
    let roleId = String(actorRole.id);
    const sameId = await c.query(`SELECT 1 FROM ${s}.roles WHERE id = $1`, [roleId]);
    if (!sameId.rowCount) {
      const sameName = await c.query<{ id: string }>(`SELECT id FROM ${s}.roles WHERE name = $1`, [actorRole.name]);
      if (sameName.rows[0]) {
        roleId = sameName.rows[0].id;
      } else {
        await insertRows(c, schema, 'roles', Object.keys(actorRole), [actorRole]);
        extra.roles = 1;
      }
    }
    const exists = await c.query(`SELECT 1 FROM ${s}.users WHERE id = $1`, [actorRow.id]);
    if (exists.rowCount) {
      await c.query(`UPDATE ${s}.users SET "roleId" = $2 WHERE id = $1`, [actorRow.id, roleId]);
    } else {
      const conflict = await c.query(`SELECT 1 FROM ${s}.users WHERE lower(email) = lower($1)`, [actorRow.email]);
      if (conflict.rowCount) {
        throw new BackupSqlError('BACKUP_ACTOR_EMAIL_CONFLICT', 'La copia tiene otro usuario con el correo de quien restaura');
      }
      const branchIds = new Set((snapshot.data.branches ?? []).map((b) => b.id));
      await insertRows(c, schema, 'users', Object.keys(actorRow), [
        {
          ...actorRow,
          roleId,
          branchId: branchIds.has(actorRow.branchId) ? actorRow.branchId : null,
          preferredBranchId: branchIds.has(actorRow.preferredBranchId) ? actorRow.preferredBranchId : null,
        },
      ]);
      extra.users = 1;
    }
    actorPreserved = true;
  }

  const outbox = await c.query(
    `UPDATE ${s}.outbox_events SET status = 'DEAD', "leaseUntil" = NULL, "lastError" = $1 WHERE status = 'PENDING'`,
    [RESTORE_NOTE],
  );
  const compensations = await c.query(
    `UPDATE ${s}.payment_compensations SET status = 'MANUAL_REVIEW', "lastError" = $1, "updatedAt" = now()
      WHERE status IN ('REQUESTED', 'REFUND_PENDING')`,
    [RESTORE_NOTE],
  );
  const orders = await c.query(
    `UPDATE ${s}.orders SET "reconciliationStatus" = 'RESTORED_FROM_BACKUP',
            "paymentExpiresAt" = GREATEST(COALESCE("paymentExpiresAt", now()), now() + ($1::bigint * interval '1 millisecond')),
            "updatedAt" = now()
      WHERE status = 'PENDIENTE' AND source = 'WEB'`,
    [reconciliationHoldMs()],
  );

  // Verificación antes del COMMIT: cada tabla tiene exactamente lo que dice la copia
  for (const table of snapshot.tables) {
    const n = await countRows(c, schema, table.name);
    const expected = table.rows + (extra[table.name] ?? 0);
    if (n !== expected) throw new BackupSqlError('BACKUP_VERIFY_FAILED', `${table.name}: ${n} filas, se esperaban ${expected}`);
  }

  const stats: TenantRestoreStats = {
    tables: snapshot.tables.length,
    rows,
    credentialsKept,
    usersFromBackup: usersInBackup - credentialsKept,
    actorPreserved,
    outboxHeld: outbox.rowCount ?? 0,
    compensationsHeld: compensations.rowCount ?? 0,
    ordersHeld: orders.rowCount ?? 0,
  };
  // Queda constancia en la tienda (Operación → anomalías) para conciliar Stripe y pagos manuales
  await c.query(
    `INSERT INTO ${s}.operational_issues (id, type, severity, "dedupeKey", details) VALUES ($1, 'BACKUP_RESTORED', 'WARN', $2, $3::jsonb)`,
    [randomUUID(), `backup-restored:${options.backupId}:${Date.now()}`, JSON.stringify({ backupId: options.backupId, ...stats })],
  );
  return stats;
}

export interface ControlRestoreStats {
  tenantsRestored: number;
  integrationsReplaced: number;
  credentialsAddedRevoked: number;
  adminsAddedInactive: number;
  signupsAdded: number;
  inboxEventsAdded: number;
}

const columnsOf = (snapshot: SchemaSnapshot, table: string): string[] => snapshot.tables.find((t) => t.name === table)?.columns ?? [];
const rowsOf = (snapshot: SchemaSnapshot, table: string) => snapshot.data[table] ?? [];

/**
 * Plano de control, dentro de la transacción del llamador. No se borra ninguna tienda ni ningún
 * administrador: las tiendas que no están en la copia quedan intactas.
 *  - tenants: las de la copia vuelven a su estado (plan, status, dominio, Stripe) por upsert.
 *  - tenant_integrations: se reemplazan las de las tiendas de la copia (siguen cifradas con TENANT_SECRETS_KEYS).
 *  - tenant_credentials: se conservan las actuales; las que solo están en la copia vuelven REVOCADAS.
 *  - platform_admins: se conservan los actuales (contraseña y estado); los que solo están en la copia
 *    vuelven DESACTIVADOS (se reactivan con `npm run platform:admin`).
 *  - tenant_signups y provider_event_inbox: se agregan los que faltan; los pendientes quedan cerrados
 *    (EXPIRED / FAILED / DEAD) para que ningún webhook ni alta se procese solo.
 */
export async function applyControlSnapshot(c: PoolClient, snapshot: SchemaSnapshot): Promise<ControlRestoreStats> {
  const tenantRows = rowsOf(snapshot, 'tenants');
  const ids = tenantRows.map((t) => String(t.id));
  const tenantCols = columnsOf(snapshot, 'tenants');
  const updates = tenantCols.filter((col) => col !== 'id').map((col) => `${qi(col)} = EXCLUDED.${qi(col)}`).join(', ');
  const tenantsRestored = await insertRows(c, 'public', 'tenants', tenantCols, tenantRows, `ON CONFLICT (id) DO UPDATE SET ${updates}`);

  await c.query('DELETE FROM public.tenant_integrations WHERE tenant_id = ANY($1::uuid[])', [ids]);
  const integrationsReplaced = await insertRows(c, 'public', 'tenant_integrations', columnsOf(snapshot, 'tenant_integrations'), rowsOf(snapshot, 'tenant_integrations'));

  const now = new Date().toISOString();
  const credentialsAddedRevoked = await insertRows(
    c,
    'public',
    'tenant_credentials',
    columnsOf(snapshot, 'tenant_credentials'),
    rowsOf(snapshot, 'tenant_credentials').map((r) => ({ ...r, revoked_at: r.revoked_at ?? now })),
    'ON CONFLICT DO NOTHING',
  );
  const adminsAddedInactive = await insertRows(
    c,
    'public',
    'platform_admins',
    columnsOf(snapshot, 'platform_admins'),
    rowsOf(snapshot, 'platform_admins').map((r) => ({ ...r, is_active: false, login_attempts: 0, locked_until: null })),
    'ON CONFLICT DO NOTHING',
  );
  const signupStatus: Record<string, string> = { PENDING: 'EXPIRED', PROVISIONING: 'FAILED' };
  const signupsAdded = await insertRows(
    c,
    'public',
    'tenant_signups',
    columnsOf(snapshot, 'tenant_signups'),
    rowsOf(snapshot, 'tenant_signups').map((r) => ({ ...r, status: signupStatus[String(r.status)] ?? r.status, password_hash: '' })),
    'ON CONFLICT DO NOTHING',
  );
  const inboxEventsAdded = await insertRows(
    c,
    'public',
    'provider_event_inbox',
    columnsOf(snapshot, 'provider_event_inbox'),
    rowsOf(snapshot, 'provider_event_inbox').map((r) =>
      r.status === 'PENDING' || r.status === 'UNRESOLVED' ? { ...r, status: 'DEAD', lease_until: null, last_error: RESTORE_NOTE } : r,
    ),
    'ON CONFLICT DO NOTHING',
  );
  return { tenantsRestored, integrationsReplaced, credentialsAddedRevoked, adminsAddedInactive, signupsAdded, inboxEventsAdded };
}
