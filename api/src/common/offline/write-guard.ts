import { Prisma } from '@prisma/client';
import { tenantSchemaSql } from '../../tenancy/tenant-context';

/**
 * Comprobación que corre DENTRO de la transacción de una escritura, con la fila ya bloqueada y leída: si
 * lanza, no se escribe nada. La usa la sincronización de cambios hechos sin conexión (OfflineSyncService)
 * para verificar que el dato sigue como lo leyó el dispositivo y dejar el recibo en la misma transacción.
 */
export type WriteGuard<T> = (tx: Prisma.TransactionClient, current: T) => Promise<void>;

type LockableTable = 'products' | 'categories' | 'collections';

/** SELECT … FOR UPDATE sobre la fila en el schema de la tienda activa */
export async function lockRow(tx: Prisma.TransactionClient, table: LockableTable, id: string): Promise<void> {
  const t = tenantSchemaSql();
  await tx.$queryRaw`SELECT "id" FROM ${t}.${Prisma.raw(`"${table}"`)} WHERE "id" = ${id} FOR UPDATE`;
}
