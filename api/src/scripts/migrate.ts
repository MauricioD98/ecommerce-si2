// Migraciones al arrancar el contenedor (CMD del Dockerfile), antes de `node dist/main`:
//   1. public (plano de control)  → si falla, el contenedor no arranca: sin public no hay tenants.
//   2. cada tienda ACTIVE/SUSPENDED → si una falla se loguea y se sigue: una tienda rota no debe
//      dejar fuera de servicio a todas. MIGRATE_STRICT=true lo vuelve fatal (útil en CI/staging).
//
// Solo levanta TenancyModule (sin HTTP, crons ni el resto de la app).
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { TenancyModule } from '../tenancy/tenancy.module';
import { TenantMigrationService, migrationDatabaseUrl } from '../tenancy/tenant-migration.service';
import { TenantProvisioningService } from '../tenancy/tenant-provisioning.service';

async function main() {
  const logger = new Logger('migrate');

  // Neon: migrate necesita la conexión DIRECTA. El pooler (PgBouncer en modo transacción, host con
  // "-pooler") no soporta los advisory locks de `prisma migrate`: se cuelga o falla a mitad de camino.
  // migrationDatabaseUrl() lanza en producción si falta DIRECT_URL o si apunta al pooler; se valida
  // antes de levantar nada para que el contenedor no arranque con una config que migra a medias.
  migrationDatabaseUrl();
  if (!process.env.DIRECT_URL) {
    logger.warn('DIRECT_URL no está definida: se migra con DATABASE_URL (solo aceptable en desarrollo local).');
  }

  const app = await NestFactory.createApplicationContext(TenancyModule, { logger: ['log', 'warn', 'error'] });
  try {
    await app.get(TenantMigrationService).deployControl();

    const { total, failed } = await app.get(TenantProvisioningService).migrateAll();
    logger.log(`Tiendas migradas: ${total - failed.length}/${total}`);

    if (failed.length > 0) {
      for (const f of failed) logger.error(`Tienda ${f.id}: ${f.error}`);
      if (process.env.MIGRATE_STRICT === 'true') process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error('Falló la migración (el servidor no se inicia):', error instanceof Error ? error.message : error);
  process.exit(1);
});
