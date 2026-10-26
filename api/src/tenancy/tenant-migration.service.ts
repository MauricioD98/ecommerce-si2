import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { assertTenantSchema } from './tenant-context';

const execFileAsync = promisify(execFile);

const TENANT_CONFIG = 'prisma.config.ts';
const CONTROL_CONFIG = 'prisma.control.config.ts';

/**
 * Aplica migraciones ejecutando `prisma migrate deploy` como proceso hijo:
 *  - deploy(schema): prisma/migrations sobre "tenant_<uuid>" (DATABASE_URL con ?schema=…), así las
 *    tablas y la propia _prisma_migrations quedan dentro del schema de la tienda.
 *  - deployControl(): prisma/control/migrations sobre "public".
 * Prisma no expone una API programática de migrate, por eso el CLI.
 */
@Injectable()
export class TenantMigrationService {
  private readonly logger = new Logger(TenantMigrationService.name);
  private readonly cwd = process.env.PRISMA_CWD ?? process.cwd();
  // Se llama al JS del CLI con el mismo node, sin npx: funciona igual en Windows y en Alpine.
  private readonly prismaCli = join(this.cwd, 'node_modules', 'prisma', 'build', 'index.js');

  // Prisma ya toma un advisory lock global por base durante migrate, así que en paralelo no
  // ganaríamos nada; encolarlos en proceso evita levantar N CLIs a la vez en un pico de altas.
  private queue: Promise<unknown> = Promise.resolve();

  deploy(schemaName: string): Promise<void> {
    assertTenantSchema(schemaName);
    return this.enqueue(schemaName, TENANT_CONFIG, { DATABASE_URL: this.urlFor(schemaName) });
  }

  // prisma.control.config.ts arma su URL desde DIRECT_URL (+ ?schema=public); se le pasa la URL ya
  // validada por migrationDatabaseUrl() para que el control siga las mismas reglas que las tiendas.
  deployControl(): Promise<void> {
    return this.enqueue('public (control)', CONTROL_CONFIG, { DIRECT_URL: migrationDatabaseUrl() });
  }

  private enqueue(label: string, config: string, env: Record<string, string>): Promise<void> {
    const run = this.queue.then(() => this.runDeploy(label, config, env));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async runDeploy(label: string, config: string, env: Record<string, string>): Promise<void> {
    const started = Date.now();
    try {
      const { stdout } = await execFileAsync(
        process.execPath,
        [this.prismaCli, 'migrate', 'deploy', '--config', config],
        {
          cwd: this.cwd,
          env: { ...process.env, ...env },
          timeout: 180_000,
          maxBuffer: 10 * 1024 * 1024,
        },
      );
      this.logger.log(`${label} migrado en ${Date.now() - started} ms`);
      this.logger.debug(stdout);
    } catch (err: any) {
      // stderr del CLI es lo único que dice qué migración falló
      const detail = (err?.stderr || err?.stdout || err?.message || String(err)).toString();
      throw new Error(`prisma migrate deploy falló en ${label}: ${detail.slice(-2000)}`);
    }
  }

  // Neon: DIRECT_URL (host sin "-pooler"). El pooler no soporta los advisory locks de migrate.
  // Mismas reglas que src/scripts/migrate.ts, aplicadas también al alta de tiendas en caliente
  // (POST /platform/tenants), que migra el schema nuevo sin pasar por el script de arranque.
  private urlFor(schemaName: string): string {
    const url = new URL(migrationDatabaseUrl());
    url.searchParams.set('schema', schemaName);
    return url.toString();
  }
}

export function migrationDatabaseUrl(): string {
  const direct = process.env.DIRECT_URL;
  if (direct) {
    if (new URL(direct).hostname.includes('-pooler')) {
      throw new Error('DIRECT_URL apunta al pooler de Neon (host con "-pooler"): usá la URL directa');
    }
    return direct;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Falta DIRECT_URL: es obligatoria en producción para correr migraciones');
  }
  const fallback = process.env.DATABASE_URL;
  if (!fallback) throw new Error('Falta DIRECT_URL / DATABASE_URL');
  return fallback;
}
