import { HttpException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { Request } from 'express';
import { Prisma } from '../../../generated/control/client';
import { ControlPrismaService } from '../../../tenancy/control-prisma.service';

/**
 * Auditoría del panel de plataforma (public.platform_audit_log, migración 20261108230000).
 *
 * - Quién: un administrador de PLATAFORMA (req.platformAdmin), la llave de scripts (PLATFORM_ADMIN_KEY, sin
 *   identidad personal), el sistema (p. ej. una suspensión por falta de pago que llega por webhook) o un
 *   intento de login anónimo. Nunca un usuario de tienda: sus acciones no pasan por /platform.
 * - Qué NO se guarda: contraseñas, tokens, claves (Stripe, cifrado, integraciones) ni contenido de respaldos.
 *   `details` solo acepta las claves de ALLOWED_DETAILS, con valores cortos.
 * - Escribir nunca rompe la acción auditada: si la tabla no existe (migración sin aplicar) o la base falla,
 *   se deja una advertencia en el log y la acción sigue.
 * - SQL parametrizado (no el cliente generado): funciona aunque el cliente de Prisma sea anterior a la tabla.
 */

export type AuditActorType = 'PLATFORM_ADMIN' | 'PLATFORM_KEY' | 'SYSTEM' | 'ANONYMOUS';
export type AuditResult = 'SUCCESS' | 'FAILURE' | 'REQUESTED';

export const AUDIT_ACTIONS = [
  'AUDIT_STARTED',
  'PLATFORM_LOGIN',
  'TENANT_CREATED',
  'TENANT_SUSPENDED',
  'TENANT_REACTIVATED',
  'TENANT_SUSPENDED_BY_BILLING',
  'TENANT_REACTIVATED_BY_BILLING',
  'TENANT_PROVISION_RETRIED',
  'TENANT_DOMAIN_CHANGED',
  'TENANT_INTEGRATION_CHANGED',
  'SUBSCRIPTION_SYNCED',
  'SIGNUP_RETRIED',
  'BACKUP_CREATED',
  'BACKUP_UPLOADED',
  'BACKUP_DOWNLOADED',
  'BACKUP_RESTORE_STARTED',
  'BACKUP_DELETED',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditActor {
  type: AuditActorType;
  id: string | null;
  email: string | null;
}

export interface AuditEntry {
  actor: AuditActor;
  action: AuditAction;
  result: AuditResult;
  tenantId?: string | null;
  targetId?: string | null;
  errorCode?: string | null;
  details?: Record<string, unknown>;
}

// Únicas claves de detalle aceptadas. Todo lo demás se descarta (defensa contra pasar un body entero).
const ALLOWED_DETAILS = new Set(['from', 'to', 'plan', 'slug', 'domain', 'provider', 'operation', 'scope', 'subscriptionStatus', 'signupId', 'reason']);
const MAX_TEXT = 200;

const clip = (value: string | null | undefined, max = MAX_TEXT) => (value == null ? null : String(value).slice(0, max));

function sanitizeDetails(details?: Record<string, unknown>): Record<string, string | number | boolean | null> | null {
  if (!details) return null;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(details)) {
    if (!ALLOWED_DETAILS.has(key)) continue;
    if (value === null || typeof value === 'number' || typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'string') out[key] = clip(value, 120);
  }
  return Object.keys(out).length ? out : null;
}

/** Código corto y no sensible para una operación fallida: "HTTP <status>: <mensaje>" o INTERNAL_ERROR. */
export function auditErrorCode(error: unknown): string {
  if (error instanceof HttpException) {
    const status = error.getStatus();
    if (status >= 500) return `HTTP ${status}`;
    const response = error.getResponse() as { message?: unknown } | string;
    const raw = typeof response === 'string' ? response : Array.isArray(response?.message) ? response.message.join(', ') : response?.message;
    // Mensajes de i18nMessage ("errors.CODIGO|{parámetros}"): se guarda solo el código, sin los parámetros
    const message = typeof raw === 'string' && raw.startsWith('errors.') ? raw.slice('errors.'.length).split('|')[0] : raw;
    return clip(`HTTP ${status}${message ? `: ${String(message)}` : ''}`)!;
  }
  // Errores no controlados pueden traer SQL, rutas o datos: solo se guarda que hubo un error interno
  return 'INTERNAL_ERROR';
}

export function auditActorFromRequest(req: Request): AuditActor {
  return req.platformAdmin
    ? { type: 'PLATFORM_ADMIN', id: req.platformAdmin.id, email: req.platformAdmin.email }
    : { type: 'PLATFORM_KEY', id: null, email: null };
}

export const SYSTEM_ACTOR: AuditActor = { type: 'SYSTEM', id: null, email: null };

export interface AuditQuery {
  action?: string;
  tenantId?: string;
  actorEmail?: string;
  result?: string;
  from?: Date;
  to?: Date;
  before?: Date; // cursor: created_at del último registro ya mostrado
  limit?: number;
}

interface AuditRow {
  id: string;
  created_at: string;
  actor_type: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  tenant_id: string | null;
  tenant_slug: string | null;
  tenant_name: string | null;
  target_id: string | null;
  result: string;
  error_code: string | null;
  details: Record<string, unknown> | null;
  job_status: string | null;
  job_error_code: string | null;
}

@Injectable()
export class PlatformAuditService {
  private readonly logger = new Logger(PlatformAuditService.name);

  constructor(private readonly control: ControlPrismaService) {}

  /** Registra una acción. Nunca lanza. */
  async record(entry: AuditEntry): Promise<void> {
    try {
      // Nombre e identificador de la tienda tal como estaban en el momento de la acción
      let tenantSlug: string | null = null;
      let tenantName: string | null = null;
      if (entry.tenantId) {
        const tenant = await this.control.tenant.findUnique({ where: { id: entry.tenantId }, select: { slug: true, name: true } }).catch(() => null);
        tenantSlug = tenant?.slug ?? null;
        tenantName = tenant?.name ?? null;
      }
      const details = sanitizeDetails(entry.details);
      await this.control.$executeRaw`
        INSERT INTO public.platform_audit_log
          (actor_type, actor_id, actor_email, action, tenant_id, tenant_slug, tenant_name, target_id, result, error_code, details)
        VALUES
          (${entry.actor.type}, ${entry.actor.id}::uuid, ${clip(entry.actor.email, 254)}, ${entry.action}, ${entry.tenantId ?? null}::uuid,
           ${tenantSlug}, ${tenantName}, ${clip(entry.targetId ?? null, 100)}, ${entry.result}, ${clip(entry.errorCode ?? null)},
           ${details ? JSON.stringify(details) : null}::jsonb)`;
    } catch (error) {
      this.logger.warn(`No se pudo registrar la auditoría ${entry.action}: ${(error as Error).message}`);
    }
  }

  /**
   * Ejecuta la acción y registra SUCCESS (o REQUESTED) o FAILURE. El error original se vuelve a lanzar.
   * `onResult` permite tomar del resultado el id afectado o detalles (p. ej. el id del backup creado).
   */
  async track<T>(
    base: Omit<AuditEntry, 'result' | 'errorCode'> & { successResult?: AuditResult },
    action: () => Promise<T>,
    onResult?: (result: T) => Partial<Pick<AuditEntry, 'targetId' | 'tenantId' | 'details'>>,
  ): Promise<T> {
    const { successResult = 'SUCCESS', ...entry } = base;
    try {
      const result = await action();
      const extra = onResult ? onResult(result) : {};
      await this.record({ ...entry, ...extra, details: { ...entry.details, ...extra.details }, result: successResult });
      return result;
    } catch (error) {
      await this.record({ ...entry, result: 'FAILURE', errorCode: auditErrorCode(error) });
      throw error;
    }
  }

  private async assertAvailable(): Promise<void> {
    const [row] = await this.control.$queryRaw<{ exists: boolean }[]>`SELECT to_regclass('public.platform_audit_log') IS NOT NULL AS "exists"`;
    if (!row?.exists) throw new ServiceUnavailableException('La auditoría todavía no está disponible: falta aplicar la migración 20261108230000_platform_audit_log');
  }

  /** Registros más recientes primero, con el estado final de las operaciones de respaldo asociadas. */
  async list(query: AuditQuery) {
    await this.assertAvailable();
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const conditions: Prisma.Sql[] = [];
    if (query.action) conditions.push(Prisma.sql`a.action = ${query.action}`);
    if (query.tenantId) conditions.push(Prisma.sql`a.tenant_id = ${query.tenantId}::uuid`);
    if (query.actorEmail) conditions.push(Prisma.sql`lower(a.actor_email) = lower(${query.actorEmail})`);
    if (query.result) conditions.push(Prisma.sql`a.result = ${query.result}`);
    // Las fechas viajan como texto ISO con zona y se convierten en SQL: pasar un Date por $queryRaw
    // (adaptador pg) pierde la zona y corre la comparación el desfase horario
    if (query.from) conditions.push(Prisma.sql`a.created_at >= ${query.from.toISOString()}::timestamptz`);
    if (query.to) conditions.push(Prisma.sql`a.created_at < ${query.to.toISOString()}::timestamptz`);
    if (query.before) conditions.push(Prisma.sql`a.created_at < ${query.before.toISOString()}::timestamptz`);
    const where = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;

    // Las operaciones de respaldo son asíncronas: su resultado final está en backup_jobs (mismo id).
    // to_regclass evita fallar si la tabla de respaldos no existiera.
    const rows = await this.control.$queryRaw<AuditRow[]>`
      SELECT a.id, a.actor_type, a.actor_id, a.actor_email, a.action, a.tenant_id, a.tenant_slug, a.tenant_name, a.target_id,
             a.result, a.error_code, a.details,
             -- ISO en UTC armado en SQL: el adaptador lee mal timestamptz en $queryRaw (lo corre el desfase horario)
             to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
             j.status::text AS job_status, j.error_code AS job_error_code
        FROM public.platform_audit_log a
        LEFT JOIN public.backup_jobs j ON a.action LIKE 'BACKUP_%' AND a.target_id IS NOT NULL
                                       AND a.target_id ~* '^[0-9a-f-]{36}$' AND j.id = a.target_id::uuid
        ${where}
       ORDER BY a.created_at DESC
       LIMIT ${limit + 1}`;

    const [started] = await this.control.$queryRaw<{ created_at: string }[]>`
      SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
        FROM public.platform_audit_log WHERE action = 'AUDIT_STARTED' ORDER BY platform_audit_log.created_at ASC LIMIT 1`;

    const page = rows.slice(0, limit);
    return {
      auditStartedAt: started?.created_at ?? null,
      hasMore: rows.length > limit,
      entries: page.map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        actorType: r.actor_type,
        actorEmail: r.actor_email,
        action: r.action,
        tenantId: r.tenant_id,
        tenantSlug: r.tenant_slug,
        tenantName: r.tenant_name,
        targetId: r.target_id,
        result: r.result,
        errorCode: r.error_code,
        details: r.details,
        // Estado actual de la operación de respaldo asociada (si la hay)
        jobStatus: r.job_status,
        jobErrorCode: r.job_error_code,
      })),
    };
  }
}
