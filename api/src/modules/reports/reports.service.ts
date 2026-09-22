import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ReportQueryDto, TopProductsQueryDto } from './dto/report-query.dto';
import { DynamicReportResultDto, SalesOverviewDto, TopProductDto } from './dto/report-response.dto';
import { validateGeneratedSql } from './sql-guard';
import { buildSystemPrompt } from './report-prompt';
import { hasAllBranches } from '../../common/utils/permission.util';
import type { AuthUser } from '../../common/decorators/interfaces/request-with-user.interface';

// Pedidos cuyo pago ya se confirmó
const PAID_STATUSES: OrderStatus[] = [OrderStatus.PROCESANDO, OrderStatus.ENVIADO, OrderStatus.ENTREGADO];

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 366;
const MAX_DYNAMIC_ROWS = 500;
const DYNAMIC_TIMEOUT = '5s';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Reportes genéricos (Prisma)
  // ---------------------------------------------------------------------------------------------

  async getSalesOverview(actor: AuthUser, query: ReportQueryDto): Promise<SalesOverviewDto> {
    const branchId = this.resolveBranchId(actor, query.branchId);
    const { from, to } = this.resolveRange(query);

    // Sin sucursal (solo alcance global) = todas. Con alcance de sucursal siempre lleva su branchId
    const where: Prisma.OrderWhereInput = {
      createdAt: { gte: from, lte: to },
      ...(branchId ? { branchId } : {}),
    };

    const [byStatus, paidTotals, salesRows] = await Promise.all([
      this.prisma.order.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.order.aggregate({
        where: { ...where, status: { in: PAID_STATUSES } },
        _sum: { totalAmount: true, discountApplied: true },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<{ date: string; revenue: number; orders: number }[]>(Prisma.sql`
        SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS date,
               COALESCE(SUM("totalAmount"), 0)::float AS revenue,
               COUNT(*)::int AS orders
        FROM orders
        WHERE "status"::text IN (${Prisma.join(PAID_STATUSES)})
          AND "createdAt" >= ${from} AND "createdAt" <= ${to}
          ${branchId ? Prisma.sql`AND "branchId" = ${branchId}` : Prisma.empty}
        GROUP BY 1
        ORDER BY 1
      `),
    ]);

    const countOf = (status: OrderStatus) => byStatus.find((row) => row.status === status)?._count._all ?? 0;
    const totalRevenue = Number(paidTotals._sum.totalAmount ?? 0);
    const paidOrders = paidTotals._count._all;

    return {
      branchId: branchId ?? null,
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      totalRevenue: round2(totalRevenue),
      totalOrders: byStatus.reduce((sum, row) => sum + row._count._all, 0),
      paidOrders,
      completedOrders: countOf(OrderStatus.ENTREGADO),
      pendingOrders: countOf(OrderStatus.PENDIENTE),
      cancelledOrders: countOf(OrderStatus.CANCELADO),
      averageOrderValue: paidOrders > 0 ? round2(totalRevenue / paidOrders) : 0,
      totalDiscounts: round2(Number(paidTotals._sum.discountApplied ?? 0)),
      salesByDay: fillMissingDays(salesRows, from, to),
    };
  }

  async getTopProducts(actor: AuthUser, query: TopProductsQueryDto): Promise<TopProductDto[]> {
    const branchId = this.resolveBranchId(actor, query.branchId);
    const { from, to } = this.resolveRange(query);
    const limit = query.limit ?? 10;

    const rows = await this.prisma.$queryRaw<
      { productId: string; name: string; sku: string; units: number; revenue: number }[]
    >(Prisma.sql`
      SELECT p."id" AS "productId", p."name", p."sku",
             SUM(oi."quantity")::int AS units,
             COALESCE(SUM(oi."quantity" * oi."price"), 0)::float AS revenue
      FROM order_items oi
      JOIN orders o ON o."id" = oi."orderId"
      JOIN products p ON p."id" = oi."productId"
      WHERE o."status"::text IN (${Prisma.join(PAID_STATUSES)})
        AND o."createdAt" >= ${from} AND o."createdAt" <= ${to}
        ${branchId ? Prisma.sql`AND o."branchId" = ${branchId}` : Prisma.empty}
      GROUP BY p."id", p."name", p."sku"
      ORDER BY units DESC, revenue DESC
      LIMIT ${limit}
    `);

    return rows.map((row) => ({ ...row, revenue: round2(row.revenue) }));
  }

  // ---------------------------------------------------------------------------------------------
  // Reportes dinámicos con IA (Text-to-SQL)
  // ---------------------------------------------------------------------------------------------

  async runDynamicReport(actor: AuthUser, prompt: string): Promise<DynamicReportResultDto> {
    // Con alcance global se ve todo; sin él, solo la sucursal propia
    const scopeBranchId = this.resolveBranchId(actor, undefined);

    const generated = await this.generateSql(prompt, scopeBranchId ?? null);

    // Capa 1: validación del texto (solo SELECT, sin palabras ni funciones peligrosas)
    let safeSql: string;
    try {
      safeSql = validateGeneratedSql(generated);
    } catch (error) {
      this.logger.warn(`SQL rechazado (${actor.email}): ${generated.replace(/\s+/g, ' ').slice(0, 300)}`);
      throw error;
    }

    // Capa 2: ejecución aislada en la base de datos
    const rows = await this.executeReadOnly(scopeBranchId ?? '*', safeSql);
    this.logger.log(`Reporte dinámico (${actor.email}): ${rows.length} filas — ${safeSql.replace(/\s+/g, ' ').slice(0, 200)}`);

    return {
      sql: safeSql,
      columns: rows.length > 0 ? Object.keys(rows[0]) : [],
      rows,
      rowCount: rows.length,
    };
  }

  private async generateSql(prompt: string, scopeBranchId: string | null): Promise<string> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException('La IA no está configurada. Falta GEMINI_API_KEY en el servidor');
    }

    try {
      const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
        model: this.config.get<string>('GEMINI_MODEL') ?? 'gemini-2.5-flash',
        // La pregunta del usuario va como contenido; las reglas, como instrucción de sistema
        systemInstruction: buildSystemPrompt({ branchId: scopeBranchId }, new Date().toISOString().slice(0, 10)),
        generationConfig: { temperature: 0, maxOutputTokens: 1024 },
      });
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (error) {
      this.logger.error(`Error al consultar Gemini: ${error instanceof Error ? error.message : error}`);
      throw new ServiceUnavailableException('No se pudo generar la consulta con la IA. Inténtalo de nuevo');
    }
  }

  // Ejecuta el SQL ya validado con un rol que SOLO puede leer las vistas del esquema "reporting".
  // Las vistas filtran por sucursal según app.branch_id ('*' = todas), que se fija aquí y no puede cambiarse
  // desde la consulta (set_config no está permitido por el validador).
  private async executeReadOnly(scope: string, safeSql: string): Promise<Record<string, unknown>[]> {
    try {
      const rows = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        await tx.$queryRaw`SELECT set_config('app.branch_id', ${scope}, true)`;
        await tx.$executeRawUnsafe('SET LOCAL ROLE storefront_reports');
        await tx.$executeRawUnsafe('SET LOCAL search_path = reporting');
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '${DYNAMIC_TIMEOUT}'`);

        // La consulta va como subconsulta para limitar siempre el número de filas
        return tx.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT * FROM (${safeSql}) AS report_result LIMIT ${MAX_DYNAMIC_ROWS}`,
        );
      });
      return rows.map(normalizeRow);
    } catch (error) {
      // El detalle técnico va al log; al usuario, un mensaje genérico
      this.logger.warn(`Fallo al ejecutar el reporte: ${error instanceof Error ? error.message : error}`);
      throw new BadRequestException('La consulta generada no se pudo ejecutar. Reformula tu pregunta');
    }
  }

  // ---------------------------------------------------------------------------------------------

  // Con alcance global se puede elegir sucursal (o ver todas); sin él, siempre la propia
  private resolveBranchId(actor: AuthUser, requested?: string): string | undefined {
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

  private resolveRange(query: ReportQueryDto): { from: Date; to: Date } {
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
}

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const startOfDay = (date: Date): Date => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
const endOfDay = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));

// Agrega los días sin ventas con valor 0 para que el gráfico no tenga huecos
function fillMissingDays(rows: { date: string; revenue: number; orders: number }[], from: Date, to: Date) {
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const result: { date: string; revenue: number; orders: number }[] = [];
  for (let time = startOfDay(from).getTime(); time <= to.getTime(); time += DAY_MS) {
    const date = new Date(time).toISOString().slice(0, 10);
    const row = byDate.get(date);
    result.push({ date, revenue: round2(row?.revenue ?? 0), orders: row?.orders ?? 0 });
  }
  return result;
}

// bigint (count) y Decimal (sum) no se pueden serializar a JSON: se pasan a número; las fechas, a texto ISO
function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      if (typeof value === 'bigint') return [key, Number(value)];
      if (value instanceof Prisma.Decimal) return [key, value.toNumber()];
      if (value instanceof Date) return [key, value.toISOString()];
      return [key, value];
    }),
  );
}
