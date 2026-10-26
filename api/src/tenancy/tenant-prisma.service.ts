import { Injectable, InternalServerErrorException, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { TenantContext, assertTenantSchema, quoteIdent, tenantStorage } from './tenant-context';

// Cuántos PrismaClient (uno por schema) se mantienen en memoria. Son baratos porque todos
// comparten el mismo pg.Pool: sacar uno del cache no cierra conexiones.
const MAX_CACHED_CLIENTS = Number(process.env.TENANT_CLIENT_CACHE ?? 100);

/**
 * Acceso a datos aislado por tienda.
 *
 * Por qué no basta con `SET search_path` sobre un cliente único: Prisma califica cada tabla con
 * el schema del adapter (`SELECT ... FROM "public"."Product"`), así que el search_path no afecta
 * las queries de modelos. Además, con el pooler de Neon (PgBouncer en modo transacción) un SET de
 * sesión se filtra a la próxima request que reciba esa conexión.
 *
 * Entonces:
 *  1. Cada tenant tiene su PrismaClient con `PrismaPg(pool, { schema })` → todas las queries de
 *     modelos van calificadas con "tenant_<uuid>". Es el aislamiento real.
 *  2. `transaction()` además hace `SET LOCAL search_path` dentro de la transacción, para que el SQL
 *     crudo sin calificar ($queryRaw) también caiga en el schema correcto. SET LOCAL muere con el
 *     COMMIT/ROLLBACK, así que es seguro con PgBouncer.
 */
@Injectable()
export class TenantPrismaService implements OnModuleDestroy {
  private readonly pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DB_POOL_MAX ?? 10),
  });

  // Map conserva orden de inserción → lo usamos como LRU.
  private readonly clients = new Map<string, PrismaClient>();

  /** Cliente del tenant del request actual. */
  get client(): PrismaClient {
    return this.forSchema(this.requireContext().schemaName);
  }

  /** Cliente de un schema explícito (crons, provisioning, scripts). */
  forSchema(schemaName: string): PrismaClient {
    assertTenantSchema(schemaName);

    const cached = this.clients.get(schemaName);
    if (cached) {
      this.clients.delete(schemaName);
      this.clients.set(schemaName, cached);
      return cached;
    }

    const client = new PrismaClient({
      adapter: new PrismaPg(this.pool, { schema: schemaName }),
      // Mismos márgenes que el PrismaService original: Neon es remoto y cada round-trip pesa.
      transactionOptions: { maxWait: 10000, timeout: 20000 },
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });

    this.clients.set(schemaName, client);
    if (this.clients.size > MAX_CACHED_CLIENTS) {
      const oldest = this.clients.keys().next().value as string;
      // Sin $disconnect: puede haber requests en vuelo usándolo y el pool es compartido.
      this.clients.delete(oldest);
    }
    return client;
  }

  /** Transacción interactiva con search_path fijado al tenant (cubre también SQL crudo). */
  async transaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<T> {
    const { schemaName } = this.requireContext();
    return this.client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${quoteIdent(schemaName)}`);
      return fn(tx);
    }, options);
  }

  currentTenant(): TenantContext | undefined {
    return tenantStorage.getStore();
  }

  private requireContext(): TenantContext {
    const ctx = tenantStorage.getStore();
    if (!ctx) {
      // Si llega acá es un bug: una ruta sin TenantMiddleware o un cron que no usó runInTenant().
      throw new InternalServerErrorException('No hay tenant en el contexto de esta operación');
    }
    return ctx;
  }

  async onModuleDestroy() {
    await Promise.allSettled([...this.clients.values()].map((c) => c.$disconnect()));
    await this.pool.end();
  }
}
