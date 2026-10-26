import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma } from '@prisma/client';

export interface TenantContext {
  tenantId: string;
  schemaName: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      // Lo setea TenantMiddleware; ausente solo en rutas excluidas (platform/*, webhooks)
      tenant?: TenantContext;
    }
  }
}

/** Tenant del contexto actual o error: para código que nunca debería correr sin tienda. */
export function requireTenant(): TenantContext {
  const ctx = tenantStorage.getStore();
  if (!ctx) throw new Error('No hay tenant en el contexto de esta operación');
  return ctx;
}

// Un store por request HTTP (lo abre TenantMiddleware). Cualquier código que corra dentro de esa
// cadena async —servicios, repos, callbacks de Prisma— ve el mismo tenant sin pasarlo a mano.
export const tenantStorage = new AsyncLocalStorage<TenantContext>();

// tenant_<uuid sin guiones> para las tiendas nuevas; tenant_legacy es el "public" original renombrado
// (prisma/control/sql/001_split_public_into_tenant_legacy.sql)
const SCHEMA_RE = /^tenant_(?:[a-f0-9]{32}|legacy)$/;

export function toSchemaName(tenantId: string): string {
  return `tenant_${tenantId.replace(/-/g, '').toLowerCase()}`;
}

// El nombre de schema termina interpolado en SQL (SET search_path, CREATE SCHEMA), así que se
// valida contra un patrón cerrado en vez de confiar en lo que venga de la DB o del request.
export function assertTenantSchema(schemaName: string): void {
  if (!SCHEMA_RE.test(schemaName)) {
    throw new Error(`Nombre de schema de tenant inválido: ${schemaName}`);
  }
}

export function quoteIdent(schemaName: string): string {
  assertTenantSchema(schemaName);
  return `"${schemaName}"`;
}

/**
 * Schema calificado del tenant actual, para SQL crudo ($queryRaw / $executeRaw). Prisma califica
 * solo las queries de modelos; en SQL crudo una tabla sin schema se resuelve con el search_path de
 * la conexión, que es "public" = plano de control → "relation orders does not exist".
 *   Prisma.sql`SELECT ... FROM ${tenantSchemaSql()}.orders`
 */
export function tenantSchemaSql(): Prisma.Sql {
  return Prisma.raw(quoteIdent(requireTenant().schemaName));
}

// Reportes con IA: cada tienda tiene su schema de vistas y su rol de solo lectura (los crea la
// migración 20261024120000_tenant_scoped_reporting con estos mismos nombres).
export function reportingSchemaOf(schemaName: string): string {
  assertTenantSchema(schemaName);
  return `${schemaName}_reporting`;
}

export function reportingRoleOf(schemaName: string): string {
  assertTenantSchema(schemaName);
  return `reports_${schemaName.slice('tenant_'.length)}`;
}

// Links que salen de la app (emails, QR, push): quien los abre puede no tener la tienda guardada
// en su navegador, así que la URL la lleva explícita. El front la lee de ?tenant= (utils/tenant.ts).
export function withTenantParam(url: string, tenantId = tenantStorage.getStore()?.tenantId): string {
  if (!tenantId) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('tenant', tenantId);
    return parsed.toString();
  } catch {
    // URL relativa (p. ej. "/account/orders/1" en las notificaciones push)
    const [path, hash] = url.split('#');
    const joined = `${path}${path.includes('?') ? '&' : '?'}tenant=${encodeURIComponent(tenantId)}`;
    return hash !== undefined ? `${joined}#${hash}` : joined;
  }
}

// Para crons, colas y scripts: ejecuta fn como si viniera de un request de ese tenant.
export function runInTenant<T>(ctx: TenantContext, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run(ctx, fn);
}
