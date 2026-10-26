import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { hasAllBranches } from '../../common/utils/permission.util';
import type { AuthUser } from '../../common/decorators/interfaces/request-with-user.interface';
import type { ReportQueryDto } from './dto/report-query.dto';

// Alcance y rango de los reportes. Compartido por ReportsService y AnalyticsService (dashboard), para
// que los dos cuenten exactamente lo mismo.

// Pedidos cuyo pago ya se confirmó
export const PAID_STATUSES: OrderStatus[] = [OrderStatus.PROCESANDO, OrderStatus.ENVIADO, OrderStatus.ENTREGADO];

export const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 366;

/** Sucursal efectiva: con alcance global la pedida (sin valor = todas); sin él, siempre la propia. */
export function resolveReportBranchId(actor: AuthUser, requested?: string): string | undefined {
  if (hasAllBranches(actor)) {
    return requested;
  }
  if (!actor.branchId) {
    throw new ForbiddenException('User is not assigned to a branch');
  }
  if (requested && requested !== actor.branchId) {
    throw new ForbiddenException('You can only view reports of your own branch');
  }
  return actor.branchId;
}

/** Rango [from 00:00, to 23:59:59.999] en UTC; por defecto, los últimos 30 días. */
export function resolveReportRange(query: ReportQueryDto): { from: Date; to: Date } {
  const now = new Date();
  const to = query.to ? endOfDay(new Date(query.to)) : now;
  const from = query.from ? startOfDay(new Date(query.from)) : startOfDay(new Date(to.getTime() - 29 * DAY_MS));

  if (from > to) {
    throw new BadRequestException('"from" must be before "to"');
  }
  if ((to.getTime() - from.getTime()) / DAY_MS > MAX_RANGE_DAYS) {
    throw new BadRequestException(`The date range cannot exceed ${MAX_RANGE_DAYS} days`);
  }
  return { from, to };
}

export const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

export const startOfDay = (date: Date): Date => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
export const endOfDay = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));

// Agrega los días sin ventas con valor 0 para que el gráfico no tenga huecos
export function fillMissingDays(rows: { date: string; revenue: number; orders: number }[], from: Date, to: Date) {
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const result: { date: string; revenue: number; orders: number }[] = [];
  for (let time = startOfDay(from).getTime(); time <= to.getTime(); time += DAY_MS) {
    const date = new Date(time).toISOString().slice(0, 10);
    const row = byDate.get(date);
    result.push({ date, revenue: round2(row?.revenue ?? 0), orders: row?.orders ?? 0 });
  }
  return result;
}
