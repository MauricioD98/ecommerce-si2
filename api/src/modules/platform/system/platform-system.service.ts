import { Injectable, Logger } from '@nestjs/common';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ControlPrismaService } from '../../../tenancy/control-prisma.service';
import { missingBillingEnv } from '../plans';
import { loadBackupKeyring } from '../../backups/backup-config';

/**
 * Estado del sistema para el panel de plataforma. Cada bloque es una comprobación REAL hecha en el
 * momento de la consulta (con su hora), o "unavailable" si no se pudo comprobar. No hay indicadores
 * supuestos: lo que no se verifica (p. ej. la conexión con Stripe o con el servidor de correo) se informa
 * como no disponible. Nunca devuelve valores de variables de entorno, hosts, rutas ni mensajes de error
 * internos (solo conteos, fechas y códigos).
 */

export type CheckStatus = 'ok' | 'warning' | 'error' | 'unavailable';

export interface Check<T = Record<string, unknown>> {
  status: CheckStatus;
  checkedAt: string;
  data: T | null;
  /** Código corto del motivo (nunca un mensaje interno) */
  reason?: string;
}

const MIGRATION_DIR_RE = /^\d{14}_[a-z0-9_]+$/i;
const STUCK_JOB_MS = 2 * 60 * 60_000;
const STUCK_EVENT_MS = 15 * 60_000;

@Injectable()
export class PlatformSystemService {
  private readonly logger = new Logger(PlatformSystemService.name);
  private readonly startedAt = new Date(Date.now() - process.uptime() * 1000);
  private readonly cwd = process.env.PRISMA_CWD ?? process.cwd();

  constructor(private readonly control: ControlPrismaService) {}

  async status() {
    const [database, migrations, backups, externalSync, signups] = await Promise.all([
      this.database(),
      this.migrations(),
      this.backups(),
      this.externalSync(),
      this.signups(),
    ]);
    return { api: this.api(), database, migrations, backups, externalSync, signups, configuration: this.configuration() };
  }

  // ---------------------------------------------------------------------------------------------

  private now() {
    return new Date().toISOString();
  }

  /** Corre una comprobación; si falla, "unavailable" con un código (el detalle queda en el log) */
  private async run<T>(name: string, fn: () => Promise<Omit<Check<T>, 'checkedAt'>>): Promise<Check<T>> {
    try {
      return { ...(await fn()), checkedAt: this.now() };
    } catch (error) {
      this.logger.warn(`Comprobación ${name} no disponible: ${(error as Error).message}`);
      return { status: 'unavailable', checkedAt: this.now(), data: null, reason: 'CHECK_FAILED' };
    }
  }

  private api(): Check {
    // Si esta respuesta existe, la API está atendiendo
    return { status: 'ok', checkedAt: this.now(), data: { startedAt: this.startedAt.toISOString(), uptimeSeconds: Math.round(process.uptime()) } };
  }

  private database() {
    return this.run('database', async () => {
      const start = process.hrtime.bigint();
      await this.control.$queryRaw`SELECT 1`;
      const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
      return { status: latencyMs > 1000 ? 'warning' : 'ok', data: { latencyMs: Math.round(latencyMs * 10) / 10 }, reason: latencyMs > 1000 ? 'SLOW' : undefined };
    });
  }

  private async migrationFolders(dir: string): Promise<string[]> {
    const entries = await readdir(join(this.cwd, ...dir.split('/')), { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && MIGRATION_DIR_RE.test(e.name)).map((e) => e.name).sort();
  }

  private migrations() {
    return this.run('migrations', async () => {
      // Plano de control: aplicadas, fallidas y pendientes respecto de las carpetas desplegadas
      const controlRows = await this.control.$queryRaw<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]>`
        SELECT migration_name, finished_at, rolled_back_at FROM public._prisma_migrations`;
      const applied = new Set(controlRows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => r.migration_name));
      const controlFailed = controlRows.filter((r) => !r.finished_at && !r.rolled_back_at).length;
      let controlPending: number | null = null;
      let latestTenant: string | null = null;
      try {
        controlPending = (await this.migrationFolders('prisma/control/migrations')).filter((name) => !applied.has(name)).length;
        latestTenant = (await this.migrationFolders('prisma/migrations')).at(-1) ?? null;
      } catch {
        // Carpetas no desplegadas junto a la API: no se puede comparar (se informa como null)
      }

      // Tiendas: su última migración (schemaVersion, la escribe el aprovisionamiento/migrate) vs la última desplegada
      const tenants = await this.control.tenant.findMany({
        where: { status: { in: ['ACTIVE', 'SUSPENDED'] } },
        select: { id: true, slug: true, name: true, schemaVersion: true },
        orderBy: { name: 'asc' },
      });
      const behind = latestTenant ? tenants.filter((t) => t.schemaVersion !== latestTenant) : [];
      const status: CheckStatus = controlFailed > 0 ? 'error' : (controlPending ?? 0) > 0 || behind.length > 0 ? 'warning' : latestTenant ? 'ok' : 'unavailable';
      return {
        status,
        reason: latestTenant ? undefined : 'MIGRATIONS_NOT_DEPLOYED',
        data: {
          control: { applied: applied.size, failed: controlFailed, pending: controlPending },
          tenants: {
            total: tenants.length,
            // null = no se pudo comparar (carpetas de migraciones no disponibles)
            outdated: latestTenant ? behind.length : null,
            outdatedStores: behind.slice(0, 20).map((t) => ({ id: t.id, slug: t.slug, name: t.name, unknownVersion: !t.schemaVersion })),
          },
        },
      };
    });
  }

  private backups() {
    return this.run('backups', async () => {
      let keyConfigured = true;
      try {
        loadBackupKeyring();
      } catch {
        keyConfigured = false;
      }
      const [counts] = await this.control.$queryRaw<
        { failed7d: number; ok7d: number; active: number; stuck: number }[]
      >`
        SELECT count(*) FILTER (WHERE status = 'FAILED' AND created_at > now() - interval '7 days')::int AS "failed7d",
               count(*) FILTER (WHERE status IN ('AVAILABLE','COMPLETED') AND created_at > now() - interval '7 days')::int AS "ok7d",
               count(*) FILTER (WHERE status IN ('PREPARING','VALIDATING','RESTORING'))::int AS "active",
               count(*) FILTER (WHERE status IN ('PREPARING','VALIDATING','RESTORING') AND created_at < now() - ${STUCK_JOB_MS / 1000} * interval '1 second')::int AS "stuck"
          FROM public.backup_jobs`;
      // Fechas como texto ISO en UTC (el adaptador lee mal los TIMESTAMP en $queryRaw)
      const last = async (where: string) =>
        (
          await this.control.$queryRawUnsafe<{ at: string; scope: string; error_code: string | null }[]>(
            `SELECT to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS at, scope::text, error_code
               FROM public.backup_jobs WHERE ${where} ORDER BY created_at DESC LIMIT 1`,
          )
        )[0] ?? null;
      const [lastOk, lastPlatformOk, lastFailure] = await Promise.all([
        last(`kind = 'BACKUP' AND status = 'AVAILABLE'`),
        last(`kind = 'BACKUP' AND status = 'AVAILABLE' AND scope = 'PLATFORM'`),
        last(`status = 'FAILED'`),
      ]);
      // created_at de backup_jobs es TIMESTAMP en hora de la sesión: se convierte a ISO con zona en el navegador
      const toIso = (local: string | undefined) => (local ? new Date(local).toISOString() : null);
      const status: CheckStatus = !keyConfigured || counts.stuck > 0 ? 'error' : counts.failed7d > 0 ? 'warning' : 'ok';
      return {
        status,
        reason: !keyConfigured ? 'BACKUP_KEY_MISSING' : counts.stuck > 0 ? 'STUCK_JOBS' : undefined,
        data: {
          keyConfigured,
          active: counts.active,
          stuck: counts.stuck,
          failedLast7Days: counts.failed7d,
          succeededLast7Days: counts.ok7d,
          lastSuccessAt: toIso(lastOk?.at),
          lastPlatformSuccessAt: toIso(lastPlatformOk?.at),
          lastFailure: lastFailure ? { at: toIso(lastFailure.at), scope: lastFailure.scope, errorCode: lastFailure.error_code } : null,
        },
      };
    });
  }

  private externalSync() {
    return this.run('externalSync', async () => {
      // Bandeja de webhooks (Stripe): lo que falta procesar o quedó sin resolver. Sin payloads ni errores internos.
      // Sus columnas las escribe Prisma en UTC sin zona: se comparan con la hora UTC y se leen como UTC.
      const [c] = await this.control.$queryRaw<
        { pending: number; unresolved: number; dead: number; processed24h: number; stuckPending: number; oldestOpen: string | null; lastProcessed: string | null }[]
      >`
        SELECT count(*) FILTER (WHERE status = 'PENDING')::int AS pending,
               count(*) FILTER (WHERE status = 'UNRESOLVED')::int AS unresolved,
               count(*) FILTER (WHERE status = 'DEAD')::int AS dead,
               count(*) FILTER (WHERE status = 'PROCESSED' AND processed_at > (now() AT TIME ZONE 'UTC') - interval '24 hours')::int AS "processed24h",
               count(*) FILTER (WHERE status = 'PENDING' AND created_at < (now() AT TIME ZONE 'UTC') - ${STUCK_EVENT_MS / 1000} * interval '1 second')::int AS "stuckPending",
               to_char(min(created_at) FILTER (WHERE status IN ('PENDING','UNRESOLVED')), 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS "oldestOpen",
               to_char(max(processed_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS "lastProcessed"
          FROM public.provider_event_inbox`;
      const problems = await this.control.$queryRaw<{ type: string; status: string; attempts: number; at: string }[]>`
        SELECT type, status::text, attempts, to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS at
          FROM public.provider_event_inbox WHERE status IN ('UNRESOLVED','DEAD') OR (status = 'PENDING' AND attempts > 0)
         ORDER BY created_at DESC LIMIT 10`;
      const toIso = (utc: string | null) => (utc ? new Date(`${utc}Z`).toISOString() : null);
      const status: CheckStatus = c.dead > 0 ? 'error' : c.unresolved > 0 || c.stuckPending > 0 ? 'warning' : 'ok';
      return {
        status,
        data: {
          pending: c.pending,
          unresolved: c.unresolved,
          dead: c.dead,
          processedLast24h: c.processed24h,
          oldestOpenAt: toIso(c.oldestOpen),
          lastProcessedAt: toIso(c.lastProcessed),
          recentProblems: problems.map((p) => ({ type: p.type, status: p.status, attempts: p.attempts, at: toIso(p.at) })),
        },
      };
    });
  }

  private signups() {
    return this.run('signups', async () => {
      const [c] = await this.control.$queryRaw<{ failed: number; stalePending: number }[]>`
        SELECT count(*) FILTER (WHERE status = 'FAILED')::int AS failed,
               count(*) FILTER (WHERE status = 'PROVISIONING' AND updated_at < (now() AT TIME ZONE 'UTC') - interval '15 minutes')::int AS "stalePending"
          FROM public.tenant_signups`;
      return { status: c.failed > 0 || c.stalePending > 0 ? 'warning' : 'ok', data: { failed: c.failed, stuckProvisioning: c.stalePending } };
    });
  }

  /** Solo si cada integración está configurada (sí/no). La conexión real no se comprueba desde acá. */
  private configuration(): Check {
    const missing = missingBillingEnv();
    return {
      status: 'ok',
      checkedAt: this.now(),
      data: {
        stripeConfigured: !missing.includes('STRIPE_SECRET_KEY') && !missing.includes('STRIPE_WEBHOOK_SECRET'),
        stripeMissingSettings: missing.length,
        emailMode: process.env.SMTP_HOST?.trim() ? 'smtp' : 'console',
      },
    };
  }
}
