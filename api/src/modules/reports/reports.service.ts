import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ReportQueryDto, TopProductsQueryDto } from './dto/report-query.dto';
import {
  DynamicReportClarificationDto,
  DynamicReportEntityDto,
  DynamicReportResultDto,
  type DynamicReportStatus,
  SalesOverviewDto,
  TopProductDto,
} from './dto/report-response.dto';
import { REPORT_VIEWS, RESTRICTED_VIEWS, inspectSql, validateGeneratedSql, type DateBound } from './sql-guard';
import { buildSystemPrompt, type PromptContext } from './report-prompt';
import { buildReportCalendar, reportCurrency, reportTimezone } from './report-calendar';
import { aiRateLimited, aiUnavailable, branchUnknown, queryFailed, reportUnavailable } from './report-errors';
import {
  ambiguousMessage,
  describeOption,
  extractPlaceholders,
  notFoundMessage,
  resolveEntity,
  substitutePlaceholders,
  type Candidate,
  type EntityKind,
  type Placeholder,
  type Resolution,
} from './entity-resolver';
import { PAID_STATUSES, fillMissingDays, resolveReportBranchId, resolveReportRange, round2 } from './report-scope';
import { quoteIdent, reportingSchemaOf, requireTenant, tenantSchemaSql } from '../../tenancy/tenant-context';
import { hasAllBranches, hasPermission } from '../../common/utils/permission.util';
import type { AuthUser } from '../../common/decorators/interfaces/request-with-user.interface';

const MAX_DYNAMIC_ROWS = 500;
const DYNAMIC_TIMEOUT = '5s';
// Nombre que devuelve <schema>.ensure_report_branch_scope(): se interpola en GRANT / search_path
const BRANCH_SCOPE_RE = /^rb_[0-9a-f]{32}$/;
// Rol global sin permisos propios dueño de report_runtime.run_report (migración 20261109120000)
const REPORT_RUNNER_ROLE = 'stella_report_runner';
// Si otro reporte del mismo ámbito tiene tomados los permisos temporales, se espera como mucho esto
const SCOPE_LOCK_TIMEOUT = '8s';

// Id válido para comprobar la forma del SQL antes de resolver los marcadores de nombres
const PROBE_ID = '00000000-0000-0000-0000-000000000000';
// Tope de opciones que se leen para resolver nombres (catálogos más grandes: ver pendientes)
const MAX_CANDIDATES = 10000;

type DynamicScope = { kind: 'all' } | { kind: 'branch'; branchId: string };
type Row = Record<string, unknown>;
// Ejecuta SQL dentro del ámbito autorizado. 'query' = la consulta de la IA (sus errores son 400);
// 'internal' = consultas propias del servidor (sus errores son 503)
type ScopeRunner = (sql: string, limit: number, kind: 'query' | 'internal') => Promise<Row[]>;
type Resolved =
  | { ids: Map<string, string>; entidades: DynamicReportEntityDto[]; avisos: string[] }
  | { clarification: DynamicReportClarificationDto; estado: 'aclaracion' | 'sin_permiso' };

// Texto exacto de la regla 8 del prompt: la IA no puede responder con estas vistas
export const UNANSWERABLE_MESSAGE = 'No puedo responder esa pregunta con los datos disponibles';

// Uso de la última llamada a Groq (para registrar costo/tokens y diagnosticar respuestas truncadas)
export interface GroqCallInfo {
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  finishReason: string | null;
  ms: number;
  emptyContent: boolean;
}

// Lleva el resultado fuera de $transaction forzando ROLLBACK
class ReportRollback extends Error {
  constructor(readonly value: unknown) {
    super('report-rollback');
  }
}

// No se pudo preparar el ámbito (rol/función ausentes, lock ocupado...): no se ejecutó la consulta
class ReportSetupError extends Error {}
// La consulta de la IA falló al ejecutarse
class ReportQueryError extends Error {}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);
  /** Última llamada a Groq de esta instancia (lo leen las pruebas reales para contar tokens) */
  lastGroqCall: GroqCallInfo | null = null;

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
        FROM ${tenantSchemaSql()}.orders
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
      FROM ${tenantSchemaSql()}.order_items oi
      JOIN ${tenantSchemaSql()}.orders o ON o."id" = oi."orderId"
      JOIN ${tenantSchemaSql()}.products p ON p."id" = oi."productId"
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
    // Con ALL_BRANCHES se ve todo; sin él, solo la sucursal propia (o 403 si no tiene ninguna)
    const scope: DynamicScope = hasAllBranches(actor)
      ? { kind: 'all' }
      : { kind: 'branch', branchId: this.resolveBranchId(actor, undefined) as string };
    // Vistas que este usuario puede leer: "empleados" exige además MANAGE_USERS (el mismo permiso que la
    // pantalla de personal). Se aplica en el validador y en la base (GRANT solo de estas vistas).
    const allowedViews = [...REPORT_VIEWS].filter((view) => {
      const required = RESTRICTED_VIEWS.get(view);
      return !required || hasPermission(actor, required);
    });
    const employeesAllowed = allowedViews.includes('empleados');
    // "Hoy", "ayer", "mes pasado"... en la hora local de la tienda
    const timezone = reportTimezone();
    const currency = reportCurrency();
    const calendar = buildReportCalendar(new Date(), timezone);
    const interpretation = { zonaHoraria: timezone, fechaHoraLocal: calendar.ahora, moneda: currency };
    const notExecuted = (estado: 'sin_permiso', mensaje: string): DynamicReportResultDto => ({
      estado,
      sql: '',
      columns: [],
      rows: [],
      rowCount: 0,
      interpretation: { ...interpretation, entidades: [], avisos: [], periodo: [] },
      clarification: { mensaje, opciones: [] },
    });

    const generated = await this.generateSql(prompt, {
      branchId: scope.kind === 'branch' ? scope.branchId : null,
      calendar,
      currency,
      employeesAllowed,
    });

    // Capa 1: marcadores de nombres bien formados y SQL válido (con un id de prueba en cada marcador),
    // ANTES de tocar la base
    let placeholders: Placeholder[];
    let probeViews: string[];
    try {
      placeholders = extractPlaceholders(generated);
      const probe = await validateGeneratedSql(substitutePlaceholders(generated, new Map(placeholders.map((p) => [p.raw, PROBE_ID]))));
      probeViews = (await inspectSql(probe)).views;
    } catch (error) {
      this.logger.warn(`SQL rechazado (${actor.email}): ${generated.replace(/\s+/g, ' ').slice(0, 300)}`);
      throw error;
    }
    // Permiso por vista: no es un error de la consulta, es falta de permiso (no se ejecuta nada)
    const forbiddenViews = probeViews.filter((view) => !allowedViews.includes(view));
    if (forbiddenViews.includes('empleados')) {
      this.logger.log(`Reporte dinámico (${actor.email}): sin_permiso — vista empleados sin MANAGE_USERS`);
      return notExecuted(
        'sin_permiso',
        'Consultar el listado de empleados requiere el permiso de gestionar empleados. Sí puedes preguntar por las ventas de cada cajero. No se consultó nada.',
      );
    }

    // Capa 2: todo dentro del ámbito autorizado (los nombres solo se buscan entre lo que el usuario ve)
    const outcome = await this.withReportScope(scope, timezone, allowedViews, async (run) => {
      const resolved = await this.resolvePlaceholders(placeholders, scope, run, employeesAllowed);
      if ('clarification' in resolved) return resolved;
      let safeSql: string;
      try {
        safeSql = await validateGeneratedSql(substitutePlaceholders(generated, resolved.ids));
      } catch (error) {
        this.logger.warn(`SQL rechazado tras resolver nombres (${actor.email}): ${generated.replace(/\s+/g, ' ').slice(0, 300)}`);
        throw error;
      }
      const rows = await run(safeSql, MAX_DYNAMIC_ROWS, 'query');
      const avisos = [...resolved.avisos, ...(await this.currencyWarnings(safeSql, currency, run)), ...employeeWarnings(safeSql)];
      return { safeSql, rows, entidades: resolved.entidades, avisos };
    });

    if ('clarification' in outcome) {
      this.logger.log(`Reporte dinámico (${actor.email}): ${outcome.estado} — ${outcome.clarification.mensaje}`);
      return {
        estado: outcome.estado,
        sql: '',
        columns: [],
        rows: [],
        rowCount: 0,
        interpretation: { ...interpretation, entidades: [], avisos: [], periodo: [] },
        clarification: outcome.clarification,
      };
    }

    const { safeSql, rows, entidades, avisos } = outcome;
    const { views, bounds } = await inspectSql(safeSql);
    const { periodo, avisos: periodWarnings } = describePeriod(bounds, views, timezone);
    const estado = resultStatus(rows);
    this.logger.log(`Reporte dinámico (${actor.email}): ${estado}, ${rows.length} filas — ${safeSql.replace(/\s+/g, ' ').slice(0, 200)}`);
    return {
      estado,
      sql: safeSql,
      columns: rows.length > 0 ? Object.keys(rows[0]) : [],
      rows,
      rowCount: rows.length,
      interpretation: { ...interpretation, entidades, avisos: [...avisos, ...periodWarnings], periodo },
    };
  }

  // Resuelve cada marcador {{tipo:texto}} contra las opciones VISIBLES en el ámbito (un usuario de una
  // sucursal solo ve la suya en "branches"). Si alguno es ambiguo o no existe, se pide aclaración y la
  // consulta de la IA NO se ejecuta.
  private async resolvePlaceholders(placeholders: Placeholder[], scope: DynamicScope, run: ScopeRunner, employeesAllowed: boolean): Promise<Resolved> {
    const ids = new Map<string, string>();
    const entidades: DynamicReportEntityDto[] = [];
    const avisos: string[] = [];
    const pending: { placeholder: Placeholder; result: Exclude<Resolution, { status: 'ok' }> }[] = [];
    const cache = new Map<EntityKind, Candidate[]>();

    for (const placeholder of placeholders) {
      if (ids.has(placeholder.raw) || pending.some((p) => p.placeholder.raw === placeholder.raw)) continue;
      if (!cache.has(placeholder.kind)) cache.set(placeholder.kind, await this.loadCandidates(placeholder.kind, run, employeesAllowed));
      const result = resolveEntity(placeholder.kind, placeholder.text, cache.get(placeholder.kind)!);
      if (result.status === 'ok') {
        ids.set(placeholder.raw, result.id);
        entidades.push({ tipo: placeholder.kind, texto: placeholder.text, nombre: result.name, metodo: result.method });
        if (result.method === 'aproximado') avisos.push(`Interpreté «${placeholder.text}» como «${result.name}».`);
      } else {
        pending.push({ placeholder, result });
      }
    }

    if (pending.length === 0) return { ids, entidades, avisos };
    const branchScoped = scope.kind === 'branch';

    // Un usuario de una sucursal nombró otra sucursal que SÍ existe en la tienda: no es una duda sobre el
    // nombre, es falta de permiso. Los nombres de sucursales ya son públicos (catálogo y retiro en tienda);
    // no se consulta ni se devuelve ningún dato de esa sucursal.
    if (branchScoped) {
      const outside: string[] = [];
      for (const { placeholder: p } of pending.filter((x) => x.placeholder.kind === 'sucursal')) {
        const storeBranches = await this.prisma.branch.findMany({ select: { id: true, name: true } });
        const match = resolveEntity('sucursal', p.text, storeBranches);
        if (match.status === 'ok') outside.push(match.name);
      }
      if (outside.length > 0) {
        return {
          estado: 'sin_permiso',
          clarification: {
            mensaje: `No tienes acceso a ${outside.map((n) => `«${n}»`).join(', ')}: tus reportes se limitan a tu sucursal. No se consultó nada.`,
            opciones: [],
          },
        };
      }
    }

    return {
      estado: 'aclaracion',
      clarification: {
        mensaje: pending
          .map(({ placeholder: p, result }) =>
            result.status === 'ambiguous' ? ambiguousMessage(p.kind, p.text, result.options) : notFoundMessage(p.kind, p.text, branchScoped),
          )
          .join(' '),
        opciones: pending.map(({ placeholder: p, result }) => ({
          tipo: p.kind,
          texto: p.text,
          opciones: result.status === 'ambiguous' ? result.options.map((o) => describeOption(p.kind, o)) : [],
        })),
      },
    };
  }

  private async loadCandidates(kind: EntityKind, run: ScopeRunner, employeesAllowed: boolean): Promise<Candidate[]> {
    // Empleados: quienes cobraron ventas en el ámbito (ventas_globales, permiso de reportes) y, si el
    // usuario puede ver el personal, también el personal del ámbito aunque todavía no haya vendido
    const employees =
      'SELECT DISTINCT cajero_id AS id, cajero_nombre AS name FROM ventas_globales WHERE cajero_id IS NOT NULL' +
      (employeesAllowed ? ' UNION SELECT id, nombre_completo AS name FROM empleados' : '');
    const sql = {
      sucursal: 'SELECT id, name FROM branches',
      producto: 'SELECT id, name, sku AS code FROM products',
      categoria: 'SELECT id, name FROM categories',
      empleado: employees,
    }[kind];
    const rows = await run(sql, MAX_CANDIDATES, 'internal');
    return rows
      .filter((row) => row.id != null && row.name != null && String(row.name).trim() !== '')
      .map((row) => ({ id: String(row.id), name: String(row.name), code: row.code == null ? null : String(row.code) }));
  }

  // Si la consulta suma importes y hay ventas cobradas con otro medio/moneda (p. ej. USDT), se avisa:
  // los importes siguen en la moneda del catálogo porque el sistema no guarda tipo de cambio
  private async currencyWarnings(safeSql: string, currency: string, run: ScopeRunner): Promise<string[]> {
    if (!/total_amount|total_neto|subtotal|monto|precio|price/i.test(safeSql) || !/^[A-Z]{3,5}$/.test(currency)) return [];
    const rows = await run(
      `SELECT DISTINCT moneda_cobro FROM ventas_globales WHERE es_venta AND moneda_cobro IS NOT NULL AND moneda_cobro <> '${currency}' ORDER BY 1`,
      50,
      'internal',
    );
    if (rows.length === 0) return [];
    const others = rows.map((r) => String(r.moneda_cobro)).join(', ');
    return [`Algunas ventas se cobraron en ${others}. El sistema guarda sus importes en ${currency} y no registra tipo de cambio, así que no se convirtió nada.`];
  }

  private async generateSql(prompt: string, context: PromptContext): Promise<string> {
    const apiKey = this.config.get<string>('GROQ_API_KEY');
    if (!apiKey) {
      throw aiUnavailable('La IA no está configurada. Falta GROQ_API_KEY en el servidor');
    }

    // SDK de OpenAI apuntando al endpoint compatible de Groq (Llama/GPT-OSS con inferencia casi instantánea)
    const groq = new OpenAI({
      apiKey,
      baseURL: 'https://api.groq.com/openai/v1',
    });

    const model = this.config.get<string>('GROQ_MODEL') ?? 'openai/gpt-oss-120b';
    const started = Date.now();
    try {
      const completion = await groq.chat.completions.create({
        model,
        temperature: 0,
        max_tokens: 1024,
        messages: [
          // Reglas, esquema, calendario local y moneda van como rol "system"
          { role: 'system', content: buildSystemPrompt(context) },
          // La pregunta del usuario va como rol "user"
          { role: 'user', content: prompt },
        ],
      });
      const content = completion.choices[0]?.message?.content ?? '';
      const usage = completion.usage;
      this.lastGroqCall = {
        model,
        promptTokens: usage?.prompt_tokens ?? null,
        completionTokens: usage?.completion_tokens ?? null,
        totalTokens: usage?.total_tokens ?? null,
        finishReason: completion.choices[0]?.finish_reason ?? null,
        ms: Date.now() - started,
        emptyContent: content.trim() === '',
      };
      const call = this.lastGroqCall;
      this.logger.log(`Groq ${model}: ${call.promptTokens} + ${call.completionTokens} tokens, fin=${call.finishReason}, ${call.ms} ms`);
      if (call.emptyContent || call.finishReason === 'length') {
        // Con modelos de razonamiento los tokens de razonamiento también cuentan contra max_tokens
        this.logger.warn(`Groq devolvió una respuesta ${call.emptyContent ? 'vacía' : 'truncada'} (fin=${call.finishReason})`);
      }
      return content;
    } catch (error) {
      const status = (error as { status?: number }).status;
      this.logger.error(`Error al consultar Groq (HTTP ${status ?? '-'}, ${Date.now() - started} ms): ${error instanceof Error ? error.message : error}`);
      if (status === 429) {
        // Límite de la cuenta de Groq (tokens o solicitudes por minuto/día) tras los reintentos del SDK
        throw aiRateLimited('La IA alcanzó el límite de uso de la cuenta de Groq. Espera un minuto e inténtalo de nuevo');
      }
      throw aiUnavailable('No se pudo generar la consulta con la IA. Inténtalo de nuevo');
    }
  }

  // Abre el ámbito autorizado y ejecuta `fn` dentro. Todo SQL corre en report_runtime.run_report(), una
  // función SECURITY DEFINER cuyo dueño es un rol global SIN permisos propios: dentro de ella PostgreSQL
  // prohíbe cambiar "role", así que nada puede volver a la cuenta de la conexión (session_user). El acceso
  // se concede en ESTA transacción y solo al schema autorizado:
  //   * ALL_BRANCHES -> "<schema>_reporting" (todas las sucursales de la tienda);
  //   * una sucursal -> "rb_<md5>", cuyas vistas filtran por el id de la sucursal escrito como literal.
  // TimeZone = zona de la tienda: las fechas (timestamptz) y current_date se interpretan en hora local.
  // La transacción pasa a solo lectura y termina SIEMPRE en ROLLBACK: los GRANT nunca se confirman y
  // cualquier set_config(..., false) se deshace. El SQL viaja como PARÁMETRO.
  private async withReportScope<T>(
    scope: DynamicScope,
    timezone: string,
    allowedViews: string[],
    fn: (run: ScopeRunner) => Promise<T>,
  ): Promise<T> {
    const { schemaName } = requireTenant();
    const scopeSchema = scope.kind === 'all' ? reportingSchemaOf(schemaName) : await this.ensureBranchScope(schemaName, scope.branchId);
    // Filtro adicional de las vistas base; el que garantiza la sucursal es el literal de "rb_*"
    const branchSetting = scope.kind === 'all' ? '*' : scope.branchId;

    try {
      await this.prisma.$transaction(async (tx) => {
        try {
          await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${SCOPE_LOCK_TIMEOUT}'`);
          await tx.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${scopeSchema}" TO ${REPORT_RUNNER_ROLE}`);
          // Solo las vistas permitidas a ESTE usuario (p. ej. "empleados" exige MANAGE_USERS) que existan en el
          // ámbito: con migraciones a medio aplicar falta alguna vista, y el resto debe seguir funcionando
          const existing = await tx.$queryRaw<{ relname: string }[]>`
            SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = ${scopeSchema} AND c.relkind = 'v'`;
          const present = new Set(existing.map((row) => row.relname));
          const viewList = allowedViews
            .filter((view) => present.has(view) && /^[a-z_]+$/.test(view))
            .map((view) => `"${scopeSchema}"."${view}"`)
            .join(', ');
          if (!viewList) throw new Error(`El ámbito ${scopeSchema} no tiene vistas de reportes`);
          await tx.$executeRawUnsafe(`GRANT SELECT ON ${viewList} TO ${REPORT_RUNNER_ROLE}`);
          await tx.$executeRawUnsafe('SET LOCAL transaction_read_only = on');
          await tx.$queryRaw`SELECT set_config('app.branch_id', ${branchSetting}, true)`;
          await tx.$queryRaw`SELECT set_config('TimeZone', ${timezone}, true)`;
          await tx.$executeRawUnsafe(`SET LOCAL search_path = "${scopeSchema}"`);
          await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '${DYNAMIC_TIMEOUT}'`);
        } catch (error) {
          throw new ReportSetupError(describeDbError(error));
        }
        const run: ScopeRunner = async (sql, limit, kind) => {
          try {
            const result = await tx.$queryRawUnsafe<{ report_row: unknown }[]>(
              'SELECT report_row FROM report_runtime.run_report($1, $2) AS report_row',
              sql,
              limit,
            );
            return result.map((r) => parseJsonRow(r.report_row));
          } catch (error) {
            throw kind === 'query' ? new ReportQueryError(describeDbError(error)) : new ReportSetupError(describeDbError(error));
          }
        };
        // Se sale con una excepción para que Prisma haga ROLLBACK en vez de COMMIT
        throw new ReportRollback(await fn(run));
      });
    } catch (error) {
      if (error instanceof ReportRollback) return error.value as T;
      if (error instanceof HttpException) throw error;
      if (error instanceof ReportSetupError) {
        this.logger.warn(`No se pudo preparar el ámbito ${scopeSchema}: ${error.message}`);
        throw reportUnavailable('No se pudo preparar el reporte con IA. No se ejecutó la consulta; inténtalo de nuevo');
      }
      // El detalle técnico va al log; al usuario, un mensaje genérico
      this.logger.warn(`Fallo al ejecutar el reporte: ${error instanceof Error ? error.message : describeDbError(error)}`);
      throw queryFailed('La consulta generada no se pudo ejecutar. Reformula tu pregunta');
    }
    throw queryFailed('La consulta generada no se pudo ejecutar. Reformula tu pregunta');
  }

  // Crea (la primera vez) o verifica el schema de reportes de la sucursal. Va FUERA de la transacción del
  // reporte porque puede ejecutar DDL. Si no se puede garantizar el alcance, no se ejecuta nada: nunca se
  // cae al schema de la tienda completa.
  private async ensureBranchScope(schemaName: string, branchId: string): Promise<string> {
    let name: unknown;
    try {
      const rows = await this.prisma.$queryRawUnsafe<{ name: string }[]>(
        `SELECT ${quoteIdent(schemaName)}.ensure_report_branch_scope($1) AS name`,
        branchId,
      );
      name = rows[0]?.name;
    } catch (error) {
      const detail = describeDbError(error);
      this.logger.warn(`No se pudo preparar el alcance de sucursal ${branchId}: ${detail}`);
      if (detail.includes('report_scope_unknown_branch') || detail.includes('report_scope_invalid_branch')) {
        throw branchUnknown('Tu sucursal asignada no existe en esta tienda. No se ejecutó la consulta');
      }
      throw reportUnavailable('Los reportes con IA por sucursal no están disponibles en esta tienda. No se ejecutó la consulta');
    }
    if (typeof name !== 'string' || !BRANCH_SCOPE_RE.test(name)) {
      throw reportUnavailable('Los reportes con IA por sucursal no están disponibles en esta tienda. No se ejecutó la consulta');
    }
    return name;
  }

  // ---------------------------------------------------------------------------------------------

  // Con alcance global se puede elegir sucursal (o ver todas); sin él, siempre la propia
  private resolveBranchId(actor: AuthUser, requested?: string): string | undefined {
    return resolveReportBranchId(actor, requested);
  }

  private resolveRange(query: ReportQueryDto): { from: Date; to: Date } {
    return resolveReportRange(query);
  }
}

// Ventas por empleado: el rol es el ACTUAL (no hay historial) y las ventas web no tienen empleado
function employeeWarnings(safeSql: string): string[] {
  const avisos: string[] = [];
  if (/cajero_rol_actual|\bempleados\b[\s\S]*\brol\b|\brol\b[\s\S]*\bempleados\b/i.test(safeSql)) {
    avisos.push('El rol que se muestra es el ACTUAL de cada empleado: el sistema no guarda qué rol tenía al momento de cada venta.');
  }
  if (/cajero_(id|nombre|rol_actual)/i.test(safeSql)) {
    avisos.push('Solo las ventas en caja (POS) registran qué empleado cobró; las ventas web no tienen empleado y no se le atribuyen a nadie.');
  }
  return avisos;
}

// Período que aplicó la consulta, en palabras: el usuario puede comprobar qué se interpretó (y cómo se
// trata la hora final: "hasta 14:00 (excluido)" no incluye una venta de las 14:00:00)
function describePeriod(bounds: DateBound[], views: string[], timezone: string): { periodo: string[]; avisos: string[] } {
  const label: Record<string, string> = {
    created_at: 'fecha del pedido/venta',
    fecha: 'fecha',
    fecha_venta: 'fecha de la venta',
    fecha_alta: 'fecha de alta',
  };
  const avisos: string[] = [];
  const byColumn = new Map<string, string[]>();
  for (const bound of bounds) {
    const text =
      bound.op === '>=' ? `desde ${bound.value} (incluido)`
      : bound.op === '>' ? `después de ${bound.value} (excluido)`
      : bound.op === '<' ? `hasta ${bound.value} (excluido)`
      : bound.op === '<=' ? `hasta ${bound.value} (incluido)`
      : `el día ${bound.value}`;
    byColumn.set(bound.column, [...(byColumn.get(bound.column) ?? []), text]);
    // "<= '2026-11-07'" corta a las 00:00 de ese día: casi siempre es un error de interpretación
    if (bound.op === '<=' && /^\d{4}-\d{2}-\d{2}$/.test(bound.value)) {
      avisos.push(`La consulta usa «hasta ${bound.value} (incluido)» sin hora: eso solo llega a las 00:00 de ese día.`);
    }
  }
  const periodo = [...byColumn.entries()].map(([column, parts]) => `${label[column] ?? column}: ${parts.join(' ')} — hora ${timezone}`);
  const datedViews = ['orders', 'order_items', 'ventas_globales', 'rendimiento_productos', 'devoluciones'];
  if (periodo.length === 0 && views.some((view) => datedViews.includes(view))) {
    periodo.push('Sin filtro de fecha: se consideró todo el historial.');
  }
  return { periodo, avisos };
}

// "sin_datos": la consulta no devolvió filas o todas sus celdas son NULL (p. ej. sum() sin filas). Un 0
// calculado (count, coalesce) SÍ es un dato: "no hubo ventas" se informa como resultado, no como vacío.
// "no_respondible": la IA aplicó la regla 8 (la pregunta no se puede responder con estas vistas).
function resultStatus(rows: Row[]): DynamicReportStatus {
  if (rows.length === 1 && Object.keys(rows[0]).length === 1 && rows[0].mensaje === UNANSWERABLE_MESSAGE) return 'no_respondible';
  if (rows.length === 0 || rows.every((row) => Object.values(row).every((value) => value === null))) return 'sin_datos';
  return 'ok';
}

// run_report devuelve cada fila como json (to_json conserva el orden de las columnas). Según la versión,
// el driver la entrega ya parseada o como texto.
function parseJsonRow(value: unknown): Record<string, unknown> {
  const row = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  return row && typeof row === 'object' && !Array.isArray(row) ? (row as Record<string, unknown>) : { valor: row };
}

// Prisma con driver adapter anida el error de PostgreSQL de distintas formas según la versión
function describeDbError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  let meta = '';
  try {
    meta = JSON.stringify((error as { meta?: unknown }).meta ?? {});
  } catch {
    meta = '';
  }
  return `${error.message} ${meta}`;
}
