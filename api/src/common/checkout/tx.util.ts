import { Prisma } from '@prisma/client';
import { tenantSchemaSql } from '../../tenancy/tenant-context';

// ORDEN ÚNICO DE BLOQUEOS en todos los flujos (carrito, checkout, POS, cron, cancelación, pago,
// devolución, ajuste), para que dos transacciones nunca se esperen en ciclo:
//   1. carrito (lockCart)  2. orden (lockOrder)  3. filas de inventario, ordenadas por
//   productId + branchId + talla  4. producto, ordenado por id (syncGlobalStockMany, al final)
// Las reservas y los intentos no necesitan turno propio: solo se modifican con su carrito u orden bloqueados.

const TRANSIENT_SQLSTATE = new Set(['40P01', '40001']); // deadlock_detected, serialization_failure

function sqlStateOf(error: unknown): string | undefined {
  let current = error as { code?: unknown; meta?: { code?: unknown }; cause?: unknown } | undefined;
  for (let depth = 0; current && depth < 6; depth += 1) {
    const candidates = [current.code, current.meta?.code, (current as { originalCode?: unknown }).originalCode];
    const match = candidates.find((value) => typeof value === 'string' && /^[0-9A-Z]{5}$/.test(value));
    if (match) return match as string;
    current = current.cause as typeof current;
  }
  return undefined;
}

export function isTransientTxError(error: unknown): boolean {
  if ((error as { code?: string })?.code === 'P2034') return true;
  const state = sqlStateOf(error);
  if (state && TRANSIENT_SQLSTATE.has(state)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /deadlock detected|could not serialize access/i.test(message);
}

export function isLockTimeout(error: unknown): boolean {
  if (sqlStateOf(error) === '55P03') return true;
  const message = error instanceof Error ? error.message : String(error);
  return /lock timeout|canceling statement due to lock/i.test(message);
}

/**
 * Reintentos acotados con jitter SOLO para conflictos transitorios de transacción. Es seguro porque la
 * transacción fallida se revirtió entera. Los errores de negocio pasan directo.
 */
export async function withTxRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= attempts || !isTransientTxError(error)) throw error;
      const backoff = Math.min(1000, 25 * 2 ** attempt);
      await new Promise((resolve) => setTimeout(resolve, backoff / 2 + Math.random() * backoff));
    }
  }
}

export async function lockCart(tx: Prisma.TransactionClient, cartId: string): Promise<void> {
  const t = tenantSchemaSql();
  await tx.$queryRaw`SELECT "id" FROM ${t}."carts" WHERE "id" = ${cartId} FOR UPDATE`;
}

export async function lockOrder(tx: Prisma.TransactionClient, orderId: string): Promise<boolean> {
  const t = tenantSchemaSql();
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM ${t}."orders" WHERE "id" = ${orderId} FOR UPDATE`;
  return rows.length > 0;
}

export function variantKey(line: { productId: string; branchId: string; size: string }): string {
  return `${line.productId}|${line.branchId}|${line.size}`;
}

export function compareVariants(
  a: { productId: string; branchId: string; size: string },
  b: { productId: string; branchId: string; size: string },
): number {
  return variantKey(a) < variantKey(b) ? -1 : variantKey(a) > variantKey(b) ? 1 : 0;
}
