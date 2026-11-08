import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { failpoint } from '../../common/checkout/failpoints';
import { SUPER_ADMIN_ROLE } from '../../common/constants/permissions';
import { i18nMessage } from '../../i18n/i18n-message';
import { assertTenantSchema } from '../../tenancy/tenant-context';
import { TenantMigrationService } from '../../tenancy/tenant-migration.service';
import { TenantResolutionCache } from '../../tenancy/tenant-resolution-cache.service';
import {
  BACKUP_FILE_EXTENSION,
  BackupKeyUnavailableError,
  backupDir,
  backupMaxBytes,
  isInsideProject,
  loadBackupKeyring,
  type BackupKeyring,
} from './backup-config';
import {
  BackupFormatError,
  FORMAT_VERSION,
  decodeBackup,
  encodeBackup,
  sha256Hex,
  type BackupManifest,
  type BackupPayload,
  type SchemaSnapshot,
  type TenantIdentity,
} from './backup-format';
import {
  CONTROL_EXCLUDED_TABLES,
  CONTROL_EXPORT_TRANSFORMS,
  PLATFORM_EXCLUDED,
  PLATFORM_INCLUDED,
  TENANT_EXCLUDED,
  TENANT_EXPORT_TRANSFORMS,
  TENANT_INCLUDED,
  applyControlSnapshot,
  applyTenantSnapshot,
} from './backup-policy';
import {
  BackupSqlError,
  appliedMigrations,
  assertCompatible,
  countRows,
  exportSchema,
  schemaExists,
  validateInStage,
} from './backup-sql';

export type BackupAccess = { kind: 'tenant'; tenantId: string } | { kind: 'platform' };

export interface BackupActor {
  type: 'TENANT_USER' | 'PLATFORM_ADMIN' | 'PLATFORM_KEY';
  id: string | null;
  email: string | null;
}

export const PLATFORM_CONFIRMATION = 'RESTORE-PLATFORM';

const ACTIVE = ['PREPARING', 'VALIDATING', 'RESTORING'];
const LOCK_ID = 7_424_001; // advisory lock que serializa "¿hay otra operación activa?" + INSERT

interface JobRow {
  id: string;
  kind: 'BACKUP' | 'RESTORE';
  scope: 'TENANT' | 'PLATFORM';
  tenant_id: string | null;
  status: string;
  origin: string | null;
  source_backup_id: string | null;
  file_name: string | null;
  size_bytes: string | null;
  sha256: string | null;
  backup_created_at: Date | null;
  summary: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  error_code: string | null;
  error_detail: string | null;
  requested_by_type: string;
  requested_by_id: string | null;
  requested_by_email: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  tenant_name?: string | null;
  tenant_slug?: string | null;
}

class JobFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function appVersion(): string {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Copias de seguridad por tienda y de la plataforma completa (ver docs/backups.md).
 *
 * - La tienda la decide SIEMPRE el servidor: en las rutas de tienda es req.tenant (JWT atado a esa tienda);
 *   en las de plataforma es el id de la URL validado contra public.tenants. Toda lectura de un trabajo
 *   compara su tenant_id guardado en la base, nunca el nombre del archivo.
 * - Los trabajos largos corren en segundo plano con estado en public.backup_jobs. Una sola operación activa
 *   por tienda; una operación de plataforma excluye a todas.
 * - Asume una única instancia de API ejecutando respaldos: al arrancar, los trabajos que quedaron activos
 *   se marcan BACKUP_INTERRUPTED (una restauración interrumpida nunca se confirmó: es una sola transacción).
 */
@Injectable()
export class BackupsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BackupsService.name);
  private readonly pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  private readonly dir = backupDir();
  private readonly maxBytes = backupMaxBytes();
  private readonly running = new Set<Promise<void>>();

  constructor(
    private readonly migrator: TenantMigrationService,
    private readonly cache: TenantResolutionCache,
  ) {}

  async onModuleInit() {
    if (isInsideProject(this.dir)) {
      this.logger.warn(`BACKUP_DIR (${this.dir}) está dentro del proyecto: muévela fuera del repositorio`);
    }
    try {
      await this.recoverInterrupted();
    } catch (e: any) {
      // Sin la migración de control aplicada el resto de la API sigue funcionando
      this.logger.warn(`No se pudo revisar backup_jobs: ${e.message}`);
    }
  }

  async onModuleDestroy() {
    await Promise.allSettled([...this.running]);
    await this.pool.end();
  }

  /** Espera los trabajos en segundo plano (pruebas y apagado). */
  async idle(): Promise<void> {
    while (this.running.size) await Promise.allSettled([...this.running]);
  }

  async recoverInterrupted(): Promise<number> {
    const res = await this.pool.query(
      `UPDATE public.backup_jobs SET status = 'FAILED', error_code = 'BACKUP_INTERRUPTED', lock_key = NULL, finished_at = now(),
              error_detail = 'La API se detuvo durante la operación; nada se aplicó a medias'
        WHERE status = ANY($1::"BackupJobStatus"[])`,
      [ACTIVE],
    );
    if (res.rowCount) this.logger.warn(`${res.rowCount} operación(es) de respaldo interrumpidas marcadas como fallidas`);
    return res.rowCount ?? 0;
  }

  config() {
    let available = true;
    try {
      loadBackupKeyring();
    } catch {
      available = false;
    }
    return { available, maxBytes: this.maxBytes, formatVersion: FORMAT_VERSION, platformConfirmation: PLATFORM_CONFIRMATION };
  }

  private keyring(): BackupKeyring {
    try {
      return loadBackupKeyring();
    } catch (e) {
      if (e instanceof BackupKeyUnavailableError) throw new ServiceUnavailableException(i18nMessage('errors.BACKUP_KEY_MISSING'));
      throw e;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Consultas
  // ---------------------------------------------------------------------------------------------

  async list(access: BackupAccess, filter: { tenantId?: string; scope?: 'TENANT' | 'PLATFORM' } = {}) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (access.kind === 'tenant') {
      params.push(access.tenantId);
      where.push(`j.scope = 'TENANT' AND j.tenant_id = $${params.length}`);
    } else {
      if (filter.scope) {
        params.push(filter.scope);
        where.push(`j.scope = $${params.length}::"BackupScope"`);
      }
      if (filter.tenantId) {
        params.push(filter.tenantId);
        where.push(`j.tenant_id = $${params.length}`);
      }
    }
    const { rows } = await this.pool.query<JobRow>(
      `SELECT j.*, t.name AS tenant_name, t.slug AS tenant_slug FROM public.backup_jobs j
         LEFT JOIN public.tenants t ON t.id = j.tenant_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY j.created_at DESC LIMIT 200`,
      params,
    );
    return rows.map((r) => this.toDto(r, access));
  }

  async get(id: string, access: BackupAccess) {
    return this.toDto(await this.loadJob(id, access), access);
  }

  /** 404 idéntico si no existe o es de otra tienda: no revela qué trabajos existen. */
  private async loadJob(id: string, access: BackupAccess): Promise<JobRow> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException(i18nMessage('errors.BACKUP_NOT_FOUND'));
    const { rows } = await this.pool.query<JobRow>(
      `SELECT j.*, t.name AS tenant_name, t.slug AS tenant_slug FROM public.backup_jobs j
         LEFT JOIN public.tenants t ON t.id = j.tenant_id WHERE j.id = $1`,
      [id],
    );
    const job = rows[0];
    if (!job) throw new NotFoundException(i18nMessage('errors.BACKUP_NOT_FOUND'));
    if (access.kind === 'tenant' && (job.scope !== 'TENANT' || job.tenant_id !== access.tenantId)) {
      throw new NotFoundException(i18nMessage('errors.BACKUP_NOT_FOUND'));
    }
    return job;
  }

  private toDto(r: JobRow, access: BackupAccess) {
    const platform = access.kind === 'platform';
    return {
      id: r.id,
      kind: r.kind,
      scope: r.scope,
      tenantId: r.tenant_id,
      tenantName: r.tenant_name ?? null,
      tenantSlug: r.tenant_slug ?? null,
      status: r.status,
      origin: r.origin,
      sourceBackupId: r.source_backup_id,
      sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes),
      sha256: r.sha256,
      backupCreatedAt: r.backup_created_at,
      summary: r.summary,
      result: r.result,
      errorCode: r.error_code,
      // El detalle técnico (schemas, tablas) es información de operación de la plataforma
      errorDetail: platform ? r.error_detail : null,
      requestedBy: {
        type: r.requested_by_type,
        email: platform || r.requested_by_type === 'TENANT_USER' ? r.requested_by_email : null,
      },
      createdAt: r.created_at,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Generar respaldos
  // ---------------------------------------------------------------------------------------------

  async createTenantBackup(tenantId: string, actor: BackupActor, access: BackupAccess) {
    this.keyring();
    const tenant = await this.tenantIdentity(tenantId);
    const job = await this.beginJob({ kind: 'BACKUP', scope: 'TENANT', tenantId, status: 'PREPARING', origin: 'GENERATED' }, actor);
    this.background(job.id, async () => {
      const snapshot = await this.readOnlySnapshot((c) =>
        exportSchema(c, tenant.schemaName, { transforms: TENANT_EXPORT_TRANSFORMS }),
      );
      const manifest = this.manifest(job.id, 'TENANT', actor, { tenant, included: TENANT_INCLUDED, excluded: TENANT_EXCLUDED });
      await this.storeBackup(job.id, { manifest, tenant: snapshot });
    });
    return this.get(job.id, access);
  }

  async createPlatformBackup(actor: BackupActor) {
    this.keyring();
    const job = await this.beginJob({ kind: 'BACKUP', scope: 'PLATFORM', tenantId: null, status: 'PREPARING', origin: 'GENERATED' }, actor);
    this.background(job.id, async () => {
      const payload = await this.readOnlySnapshot(async (c) => {
        // Una sola transacción REPEATABLE READ: control y todas las tiendas salen de la misma foto
        const control = await exportSchema(c, 'public', { exclude: CONTROL_EXCLUDED_TABLES, transforms: CONTROL_EXPORT_TRANSFORMS });
        const tenants: Record<string, SchemaSnapshot> = {};
        const identities: (TenantIdentity & { schemaIncluded: boolean })[] = [];
        for (const row of control.data.tenants ?? []) {
          const identity = toIdentity(row);
          assertTenantSchema(identity.schemaName);
          const included = await schemaExists(c, identity.schemaName);
          if (included) tenants[identity.id] = await exportSchema(c, identity.schemaName, { transforms: TENANT_EXPORT_TRANSFORMS });
          identities.push({ ...identity, schemaIncluded: included });
        }
        return { control, tenants, identities };
      });
      const manifest = this.manifest(job.id, 'PLATFORM', actor, {
        tenants: payload.identities,
        controlMigrations: payload.control.migrations,
        included: PLATFORM_INCLUDED,
        excluded: [
          ...PLATFORM_EXCLUDED,
          ...payload.identities.filter((t) => !t.schemaIncluded).map((t) => ({ id: 'tenantSchemaMissing', detail: `${t.slug}: el schema no existía al respaldar` })),
        ],
      });
      await this.storeBackup(job.id, { manifest, control: payload.control, tenants: payload.tenants });
    });
    return this.get(job.id, { kind: 'platform' });
  }

  private manifest(
    backupId: string,
    scope: 'TENANT' | 'PLATFORM',
    actor: BackupActor,
    rest: Pick<BackupManifest, 'included' | 'excluded'> & Partial<BackupManifest>,
  ): BackupManifest {
    return {
      format: 'stella-femme-backup',
      formatVersion: FORMAT_VERSION,
      backupId,
      scope,
      createdAt: new Date().toISOString(),
      app: { name: 'stella-femme-api', version: appVersion() },
      createdBy: { type: actor.type, id: actor.id, email: actor.email },
      ...rest,
    };
  }

  private async readOnlySnapshot<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const result = await fn(c);
      await c.query('COMMIT');
      return result;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  private async storeBackup(jobId: string, payload: BackupPayload): Promise<void> {
    const { file } = encodeBackup(payload, this.keyring());
    if (file.length > this.maxBytes) throw new JobFailure('BACKUP_TOO_LARGE', `El respaldo mide ${file.length} bytes (máximo ${this.maxBytes})`);
    const fileName = await this.writeFileAtomic(jobId, file);
    await this.pool.query(
      // backup_created_at es TIMESTAMP sin zona, igual que created_at (CURRENT_TIMESTAMP = hora de la sesión).
      // El ISO del manifiesto termina en "Z": sin ::timestamptz PostgreSQL descarta la zona y guarda la hora UTC
      // como si fuera local, y al leerla (pg la interpreta como local) queda corrida el desfase horario.
      `UPDATE public.backup_jobs SET status = 'AVAILABLE', file_name = $2, size_bytes = $3, sha256 = $4, backup_created_at = $5::timestamptz,
              summary = $6::jsonb, lock_key = NULL, finished_at = now() WHERE id = $1`,
      [jobId, fileName, file.length, sha256Hex(file), payload.manifest.createdAt, JSON.stringify(summarize(payload))],
    );
  }

  private async writeFileAtomic(jobId: string, file: Buffer): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const fileName = `${jobId}${BACKUP_FILE_EXTENSION}`;
    const tmp = join(this.dir, `${fileName}.tmp`);
    await writeFile(tmp, file, { mode: 0o600 });
    await rename(tmp, join(this.dir, fileName));
    return fileName;
  }

  // ---------------------------------------------------------------------------------------------
  // Descargar, subir, borrar
  // ---------------------------------------------------------------------------------------------

  /** Devuelve el archivo solo si su SHA-256 coincide con el registrado al generarlo o subirlo. */
  async download(id: string, access: BackupAccess): Promise<{ file: Buffer; downloadName: string }> {
    const job = await this.loadJob(id, access);
    const file = await this.readVerifiedFile(job);
    const date = (job.backup_created_at ?? job.created_at).toISOString().slice(0, 10);
    const label = job.scope === 'PLATFORM' ? 'plataforma' : (job.tenant_slug ?? 'tienda').replace(/[^a-z0-9-]/gi, '');
    return { file, downloadName: `respaldo-${label}-${date}-${job.id.slice(0, 8)}${BACKUP_FILE_EXTENSION}` };
  }

  private async readVerifiedFile(job: JobRow): Promise<Buffer> {
    if (job.kind !== 'BACKUP' || job.status !== 'AVAILABLE' || !job.file_name) {
      throw new ConflictException(i18nMessage('errors.BACKUP_NOT_AVAILABLE'));
    }
    const path = join(this.dir, job.file_name);
    if (!/^[0-9a-f-]{36}\.sfbk$/.test(job.file_name) || !existsSync(path)) {
      throw new NotFoundException(i18nMessage('errors.BACKUP_FILE_MISSING'));
    }
    const file = await readFile(path);
    if (sha256Hex(file) !== job.sha256) throw new BadRequestException(i18nMessage('errors.BACKUP_INTEGRITY_FAILED'));
    return file;
  }

  /**
   * Sube una copia descargada antes. Se acepta solo si descifra y autentica con la clave del servidor
   * (origen e integridad) y, en una tienda, si es de ESA tienda. No se ejecuta nada del archivo.
   */
  async upload(file: Buffer | undefined, access: BackupAccess, actor: BackupActor) {
    if (!file?.length) throw new BadRequestException(i18nMessage('errors.BACKUP_FILE_REQUIRED'));
    if (file.length > this.maxBytes) throw new PayloadTooLargeException(i18nMessage('errors.BACKUP_FILE_TOO_LARGE'));
    const { header, payload } = this.decodeOrThrow(file);
    if (access.kind === 'tenant' && (header.scope !== 'TENANT' || header.tenantId !== access.tenantId)) {
      throw new ForbiddenException(i18nMessage('errors.BACKUP_WRONG_TENANT'));
    }
    const id = randomUUID();
    const fileName = await this.writeFileAtomic(id, file);
    await this.pool.query(
      `INSERT INTO public.backup_jobs (id, kind, scope, tenant_id, status, origin, file_name, size_bytes, sha256, backup_created_at, summary,
                                       requested_by_type, requested_by_id, requested_by_email, started_at, finished_at)
       VALUES ($1, 'BACKUP', $2, $3, 'AVAILABLE', 'UPLOADED', $4, $5, $6, $7::timestamptz, $8::jsonb, $9, $10, $11, now(), now())`,
      [id, header.scope, header.tenantId, fileName, file.length, sha256Hex(file), header.createdAt,
        JSON.stringify({ ...summarize(payload), originalBackupId: header.backupId }), actor.type, actor.id, actor.email],
    );
    return this.get(id, access);
  }

  private decodeOrThrow(file: Buffer) {
    try {
      return decodeBackup(file, this.keyring());
    } catch (e) {
      if (e instanceof BackupFormatError) throw new BadRequestException(i18nMessage(`errors.${e.code}`));
      throw e;
    }
  }

  async remove(id: string, access: BackupAccess) {
    const job = await this.loadJob(id, access);
    if (job.kind !== 'BACKUP' || ACTIVE.includes(job.status)) throw new ConflictException(i18nMessage('errors.BACKUP_NOT_AVAILABLE'));
    const busy = await this.pool.query(`SELECT 1 FROM public.backup_jobs WHERE source_backup_id = $1 AND status = ANY($2::"BackupJobStatus"[])`, [id, ACTIVE]);
    if (busy.rowCount) throw new ConflictException(i18nMessage('errors.BACKUP_ALREADY_RUNNING'));
    if (job.file_name && /^[0-9a-f-]{36}\.sfbk$/.test(job.file_name)) await rm(join(this.dir, job.file_name), { force: true });
    await this.pool.query('DELETE FROM public.backup_jobs WHERE id = $1', [id]);
    return { id, deleted: true };
  }

  // ---------------------------------------------------------------------------------------------
  // Vista previa y restauración
  // ---------------------------------------------------------------------------------------------

  async preview(id: string, access: BackupAccess, actor?: BackupActor) {
    const job = await this.loadJob(id, access);
    const file = await this.readVerifiedFile(job);
    const { header, payload } = this.decodeOrThrow(file);
    this.assertSameOrigin(job, header.scope, header.tenantId);
    const c = await this.pool.connect();
    try {
      const problems: { code: string; detail: string }[] = [];
      if (header.scope === 'TENANT') {
        const tenant = await this.tenantIdentity(job.tenant_id!);
        const snapshot = payload.tenant!;
        const tables: { name: string; backupRows: number; currentRows: number | null }[] = [];
        if (!(await schemaExists(c, tenant.schemaName))) {
          problems.push({ code: 'BACKUP_TENANT_SCHEMA_MISSING', detail: tenant.schemaName });
        } else {
          await assertCompatible(c, tenant.schemaName, snapshot).catch((e) => problems.push({ code: e.code ?? 'BACKUP_INCOMPATIBLE_VERSION', detail: e.message }));
          for (const t of snapshot.tables) {
            tables.push({ name: t.name, backupRows: t.rows, currentRows: await countRows(c, tenant.schemaName, t.name).catch(() => null) });
          }
          if (actor?.type === 'TENANT_USER' && actor.id && !snapshot.data.users?.some((u) => u.id === actor.id)) {
            const email = actor.email?.toLowerCase();
            if (email && snapshot.data.users?.some((u) => String(u.email).toLowerCase() === email)) {
              problems.push({ code: 'BACKUP_ACTOR_EMAIL_CONFLICT', detail: email });
            }
          }
        }
        return {
          backup: this.toDto(job, access),
          scope: 'TENANT' as const,
          tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
          backupCreatedAt: payload.manifest.createdAt,
          appVersion: payload.manifest.app.version,
          included: payload.manifest.included,
          excluded: payload.manifest.excluded,
          tables,
          compatible: problems.length === 0,
          problems: access.kind === 'platform' ? problems : problems.map((p) => ({ code: p.code, detail: '' })),
          confirmationPhrase: tenant.slug,
        };
      }

      // Plataforma
      await assertCompatible(c, 'public', payload.control!, CONTROL_EXCLUDED_TABLES).catch((e) => problems.push({ code: e.code ?? 'BACKUP_INCOMPATIBLE_VERSION', detail: `public: ${e.message}` }));
      const tenants: { id: string; slug: string; name: string; schemaIncluded: boolean; existsNow: boolean; rows: number }[] = [];
      for (const t of payload.manifest.tenants ?? []) {
        const exists = await schemaExists(c, t.schemaName);
        const snapshot = payload.tenants?.[t.id];
        if (exists && snapshot) {
          await assertCompatible(c, t.schemaName, snapshot).catch((e) => problems.push({ code: e.code ?? 'BACKUP_INCOMPATIBLE_VERSION', detail: `${t.slug}: ${e.message}` }));
        }
        tenants.push({
          id: t.id,
          slug: t.slug,
          name: t.name,
          schemaIncluded: t.schemaIncluded,
          existsNow: exists,
          rows: snapshot ? snapshot.tables.reduce((sum, x) => sum + x.rows, 0) : 0,
        });
      }
      const inBackup = new Set(tenants.map((t) => t.id));
      const current = await c.query<{ id: string; slug: string; name: string }>('SELECT id, slug, name FROM public.tenants ORDER BY created_at');
      return {
        backup: this.toDto(job, access),
        scope: 'PLATFORM' as const,
        backupCreatedAt: payload.manifest.createdAt,
        appVersion: payload.manifest.app.version,
        included: payload.manifest.included,
        excluded: payload.manifest.excluded,
        tenants,
        // Tiendas creadas después de la copia: no se tocan
        preservedTenants: current.rows.filter((t) => !inBackup.has(t.id)),
        compatible: problems.length === 0,
        problems,
        confirmationPhrase: PLATFORM_CONFIRMATION,
      };
    } finally {
      c.release();
    }
  }

  /** Encabezado autenticado == registro del servidor: una copia de la tienda A nunca se aplica en B. */
  private assertSameOrigin(job: JobRow, scope: string, tenantId: string | null) {
    if (scope !== job.scope || tenantId !== job.tenant_id) throw new ForbiddenException(i18nMessage('errors.BACKUP_WRONG_TENANT'));
  }

  async startRestore(id: string, access: BackupAccess, actor: BackupActor, body: { confirmation?: string; acknowledgeReplace?: boolean }) {
    this.keyring();
    const job = await this.loadJob(id, access);
    if (job.kind !== 'BACKUP' || job.status !== 'AVAILABLE') throw new ConflictException(i18nMessage('errors.BACKUP_NOT_AVAILABLE'));
    const expected = job.scope === 'PLATFORM' ? PLATFORM_CONFIRMATION : (await this.tenantIdentity(job.tenant_id!)).slug;
    if (body.acknowledgeReplace !== true || (body.confirmation ?? '').trim() !== expected) {
      throw new BadRequestException(i18nMessage('errors.BACKUP_CONFIRMATION_MISMATCH'));
    }
    if (actor.type === 'TENANT_USER') await this.assertStillOwner(job.tenant_id!, actor.id!);

    const restore = await this.beginJob(
      { kind: 'RESTORE', scope: job.scope, tenantId: job.tenant_id, status: 'VALIDATING', sourceBackupId: job.id },
      actor,
    );
    const tenantActor = actor.type === 'TENANT_USER' && actor.id ? { id: actor.id } : undefined;
    this.background(restore.id, async () => {
      const result = job.scope === 'TENANT' ? await this.restoreTenant(restore.id, job, tenantActor) : await this.restorePlatform(restore.id, job);
      await this.pool.query(
        `UPDATE public.backup_jobs SET status = 'COMPLETED', result = $2::jsonb, lock_key = NULL, finished_at = now() WHERE id = $1`,
        [restore.id, JSON.stringify(result)],
      );
    });
    return this.get(restore.id, access);
  }

  /** El rol del JWT puede tener hasta 15 min: para una restauración se vuelve a mirar la base. */
  private async assertStillOwner(tenantId: string, userId: string) {
    const tenant = await this.tenantIdentity(tenantId);
    const { rows } = await this.pool.query(
      `SELECT r.name FROM "${tenant.schemaName}".users u JOIN "${tenant.schemaName}".roles r ON r.id = u."roleId" WHERE u.id = $1`,
      [userId],
    );
    if (rows[0]?.name !== SUPER_ADMIN_ROLE) throw new ForbiddenException(i18nMessage('errors.BACKUP_OWNER_ONLY'));
  }

  private async loadPayload(job: JobRow): Promise<BackupPayload> {
    const file = await this.readVerifiedFile(job).catch(() => {
      throw new JobFailure('BACKUP_INTEGRITY_FAILED', 'El archivo no está o su SHA-256 no coincide con el registrado');
    });
    try {
      const { header, payload } = decodeBackup(file, this.keyring());
      if (header.scope !== job.scope || header.tenantId !== job.tenant_id) throw new JobFailure('BACKUP_WRONG_TENANT', 'La copia es de otra tienda');
      return payload;
    } catch (e) {
      if (e instanceof BackupFormatError) throw new JobFailure(e.code, e.message);
      throw e;
    }
  }

  private async restoreTenant(restoreId: string, job: JobRow, actor?: { id: string }) {
    const payload = await this.loadPayload(job);
    const tenant = await this.tenantIdentity(job.tenant_id!);
    const snapshot = payload.tenant!;
    if (!(await this.withClient((c) => schemaExists(c, tenant.schemaName)))) {
      throw new JobFailure('BACKUP_TENANT_SCHEMA_MISSING', `No existe ${tenant.schemaName}`);
    }

    // 1) Validación aislada: schema temporal + ROLLBACK (no toca los datos actuales)
    await this.inTransaction(true, async (c) => {
      await assertCompatible(c, tenant.schemaName, snapshot);
      await validateInStage(c, tenant.schemaName, snapshot);
    }, 'BACKUP_VALIDATION_FAILED');
    await this.setStatus(restoreId, 'RESTORING');

    // 2) Aplicación: una sola transacción; cualquier error → ROLLBACK, la tienda queda como estaba
    const stats = await this.inTransaction(false, async (c) => {
      await assertCompatible(c, tenant.schemaName, snapshot);
      const result = await applyTenantSnapshot(c, tenant.schemaName, snapshot, { actor, backupId: job.id });
      await failpoint('backup.restore.beforeCommit');
      return result;
    }, 'BACKUP_RESTORE_FAILED');
    return { tenant: { id: tenant.id, slug: tenant.slug }, backupCreatedAt: payload.manifest.createdAt, ...stats };
  }

  private async restorePlatform(restoreId: string, job: JobRow) {
    const payload = await this.loadPayload(job);
    const control = payload.control!;
    const targets = (payload.manifest.tenants ?? []).filter((t) => t.schemaIncluded && payload.tenants?.[t.id]);

    // Schemas que están en la copia y no en esta base (p. ej. entorno nuevo): se crean vacíos y se migran.
    // Es lo único que se hace fuera de la transacción y no modifica datos existentes.
    const createdSchemas: string[] = [];
    for (const t of targets) {
      assertTenantSchema(t.schemaName);
      if (!(await this.withClient((c) => schemaExists(c, t.schemaName)))) {
        await this.withClient((c) => c.query(`CREATE SCHEMA IF NOT EXISTS "${t.schemaName}"`));
        await this.migrator.deploy(t.schemaName);
        createdSchemas.push(t.schemaName);
      }
    }

    await this.inTransaction(true, async (c) => {
      await assertCompatible(c, 'public', control, CONTROL_EXCLUDED_TABLES);
      await validateInStage(c, 'public', control);
      for (const t of targets) {
        await assertCompatible(c, t.schemaName, payload.tenants![t.id]);
        await validateInStage(c, t.schemaName, payload.tenants![t.id]);
      }
    }, 'BACKUP_VALIDATION_FAILED');
    await this.setStatus(restoreId, 'RESTORING');

    const result = await this.inTransaction(false, async (c) => {
      const controlStats = await applyControlSnapshot(c, control);
      const tenants: Record<string, unknown> = {};
      for (const t of targets) {
        tenants[t.slug] = await applyTenantSnapshot(c, t.schemaName, payload.tenants![t.id], { backupId: job.id });
      }
      await failpoint('backup.restore.beforeCommit');
      return { control: controlStats, tenants };
    }, 'BACKUP_RESTORE_FAILED');
    this.cache.clear();
    return { backupCreatedAt: payload.manifest.createdAt, createdSchemas, ...result };
  }

  // ---------------------------------------------------------------------------------------------
  // Infraestructura
  // ---------------------------------------------------------------------------------------------

  private async beginJob(
    fields: { kind: 'BACKUP' | 'RESTORE'; scope: 'TENANT' | 'PLATFORM'; tenantId: string | null; status: string; origin?: string; sourceBackupId?: string },
    actor: BackupActor,
  ): Promise<{ id: string }> {
    const id = randomUUID();
    const lockKey = fields.scope === 'PLATFORM' ? 'platform' : `tenant:${fields.tenantId}`;
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT pg_advisory_xact_lock($1)', [LOCK_ID]);
      const conflict = await c.query(
        `SELECT 1 FROM public.backup_jobs WHERE status = ANY($1::"BackupJobStatus"[])
            AND ($2 = 'platform' OR lock_key IN ($2, 'platform')) LIMIT 1`,
        [ACTIVE, lockKey],
      );
      if (conflict.rowCount) throw new ConflictException(i18nMessage('errors.BACKUP_ALREADY_RUNNING'));
      await c.query(
        `INSERT INTO public.backup_jobs (id, kind, scope, tenant_id, status, origin, source_backup_id, requested_by_type, requested_by_id,
                                         requested_by_email, lock_key, started_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())`,
        [id, fields.kind, fields.scope, fields.tenantId, fields.status, fields.origin ?? null, fields.sourceBackupId ?? null, actor.type, actor.id, actor.email, lockKey],
      );
      await c.query('COMMIT');
      return { id };
    } catch (e: any) {
      await c.query('ROLLBACK').catch(() => undefined);
      if (e?.code === '23505') throw new ConflictException(i18nMessage('errors.BACKUP_ALREADY_RUNNING'));
      throw e;
    } finally {
      c.release();
    }
  }

  private background(jobId: string, fn: () => Promise<void>) {
    const task = fn()
      .catch(async (e: any) => {
        const code = e instanceof JobFailure || e instanceof BackupSqlError || e instanceof BackupFormatError ? e.code : 'BACKUP_FAILED';
        // Solo el mensaje (nunca e.detail de PostgreSQL, que puede traer valores de filas)
        const detail = String(e?.message ?? e).slice(0, 2000);
        this.logger.error(`Operación de respaldo ${jobId} falló: ${code} ${detail}`);
        await this.pool
          .query(`UPDATE public.backup_jobs SET status = 'FAILED', error_code = $2, error_detail = $3, lock_key = NULL, finished_at = now() WHERE id = $1`, [jobId, code, detail])
          .catch((err) => this.logger.error(`No se pudo registrar la falla de ${jobId}: ${err.message}`));
      })
      .finally(() => this.running.delete(task));
    this.running.add(task);
  }

  private async setStatus(id: string, status: string) {
    await this.pool.query(`UPDATE public.backup_jobs SET status = $2 WHERE id = $1`, [id, status]);
  }

  private async withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      return await fn(c);
    } finally {
      c.release();
    }
  }

  /** rollbackAlways = validación (nunca confirma). Si falla, el error lleva failCode salvo que ya traiga uno propio. */
  private async inTransaction<T>(rollbackAlways: boolean, fn: (c: PoolClient) => Promise<T>, failCode: string): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SET LOCAL lock_timeout = '15s'`);
      const result = await fn(c);
      await c.query(rollbackAlways ? 'ROLLBACK' : 'COMMIT');
      return result;
    } catch (e: any) {
      await c.query('ROLLBACK').catch(() => undefined);
      if (e instanceof BackupSqlError && e.code !== 'BACKUP_VALIDATION_FAILED') throw e;
      throw new JobFailure(failCode, String(e?.message ?? e));
    } finally {
      c.release();
    }
  }

  async tenantIdentity(tenantId: string): Promise<TenantIdentity> {
    if (!/^[0-9a-f-]{36}$/i.test(tenantId)) throw new NotFoundException(i18nMessage('errors.BACKUP_TENANT_NOT_FOUND'));
    const { rows } = await this.pool.query(`SELECT id, slug, name, schema_name, plan, status FROM public.tenants WHERE id = $1`, [tenantId]);
    if (!rows[0]) throw new NotFoundException(i18nMessage('errors.BACKUP_TENANT_NOT_FOUND'));
    const identity = toIdentity(rows[0]);
    assertTenantSchema(identity.schemaName);
    return identity;
  }

  /** Migraciones aplicadas (para la documentación / diagnóstico desde scripts). */
  async migrationsOf(schema: string) {
    return this.withClient((c) => appliedMigrations(c, schema));
  }
}

function toIdentity(row: Record<string, unknown>): TenantIdentity {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    schemaName: String(row.schema_name),
    plan: String(row.plan),
    status: String(row.status),
  };
}

function summarize(payload: BackupPayload) {
  const m = payload.manifest;
  const tableSummary = (s: SchemaSnapshot) => s.tables.map((t) => ({ name: t.name, rows: t.rows }));
  const lastMigration = (s: SchemaSnapshot) => s.migrations[s.migrations.length - 1] ?? null;
  return {
    formatVersion: m.formatVersion,
    appVersion: m.app.version,
    createdAt: m.createdAt,
    included: m.included,
    excluded: m.excluded,
    ...(m.scope === 'TENANT'
      ? {
          tenant: { id: m.tenant!.id, slug: m.tenant!.slug, name: m.tenant!.name },
          migration: lastMigration(payload.tenant!),
          tables: tableSummary(payload.tenant!),
          totalRows: payload.tenant!.tables.reduce((n, t) => n + t.rows, 0),
        }
      : {
          controlMigration: lastMigration(payload.control!),
          tenants: (m.tenants ?? []).map((t) => ({
            id: t.id,
            slug: t.slug,
            name: t.name,
            schemaIncluded: t.schemaIncluded,
            rows: payload.tenants?.[t.id]?.tables.reduce((n, x) => n + x.rows, 0) ?? 0,
          })),
          totalRows:
            payload.control!.tables.reduce((n, t) => n + t.rows, 0) +
            Object.values(payload.tenants ?? {}).reduce((n, s) => n + s.tables.reduce((k, t) => k + t.rows, 0), 0),
        }),
  };
}
