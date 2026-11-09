import { loadModule, parseSync } from 'libpg-query';
import { queryRejected, reportUnavailable } from './report-errors';

// Validación del SQL que devuelve la IA, sobre el árbol sintáctico del parser REAL de PostgreSQL
// (libpg-query). Todo es lista PERMITIDA: tipos de nodo, vistas, funciones, tipos de dato. Los textos
// literales ('Set Deportivo', 'do', 'public'...) nunca se inspeccionan, así que no generan falsos
// rechazos. No hay límite de tablas, JOIN ni subconsultas: GROUP BY, HAVING, WITH, UNION y ventanas
// están permitidos mientras solo lean las vistas de reportes.
//
// ES UNA CAPA, NO LA ÚNICA: el aislamiento lo da la base (report_runtime.run_report corre como un rol
// sin permisos propios, que solo recibe acceso al schema autorizado dentro de una transacción que se
// deshace; ver migración 20261109120000). El validador evita además funciones con efectos (set_config,
// pg_sleep...) y la lectura del catálogo pg_*, que PUBLIC sí puede leer y la base no puede negar a un
// rol concreto.

// Vistas que existen en "<schema>_reporting" y en cada schema de sucursal "rb_<md5>"
export const REPORT_VIEWS: ReadonlySet<string> = new Set([
  'branches',
  'orders',
  'order_items',
  'products',
  'categories',
  'product_inventories',
  'users',
  'ventas_globales',
  'rendimiento_productos',
  'devoluciones',
]);

// Funciones invocables (nombre sin schema). Agregados, ventanas, fechas, texto y matemática simple.
const ALLOWED_FUNCTIONS = new Set([
  // agregados
  'count', 'sum', 'avg', 'min', 'max', 'string_agg', 'array_agg', 'bool_and', 'bool_or', 'every',
  'stddev', 'stddev_pop', 'stddev_samp', 'variance', 'var_pop', 'var_samp',
  'percentile_cont', 'percentile_disc', 'mode',
  // ventanas
  'row_number', 'rank', 'dense_rank', 'percent_rank', 'cume_dist', 'ntile', 'lag', 'lead',
  'first_value', 'last_value', 'nth_value',
  // matemática
  'round', 'ceil', 'ceiling', 'floor', 'abs', 'trunc', 'mod', 'power', 'sqrt', 'sign',
  // fechas
  'now', 'date_trunc', 'date_part', 'extract', 'to_char', 'to_date', 'to_timestamp', 'age', 'date',
  'make_date', 'make_interval', 'justify_interval', 'timezone', 'generate_series',
  // texto
  'lower', 'upper', 'initcap', 'trim', 'btrim', 'ltrim', 'rtrim', 'length', 'char_length',
  'substring', 'substr', 'left', 'right', 'concat', 'concat_ws', 'replace', 'position', 'strpos',
  'lpad', 'rpad', 'split_part', 'coalesce', 'nullif', 'greatest', 'least',
]);

// Tipos válidos en CAST / :: (último nombre; el parser los normaliza a pg_catalog.<tipo>)
const ALLOWED_TYPES = new Set([
  'int2', 'int4', 'int8', 'smallint', 'integer', 'int', 'bigint', 'numeric', 'decimal', 'float4',
  'float8', 'real', 'text', 'varchar', 'bpchar', 'char', 'date', 'timestamp', 'timestamptz',
  'interval', 'time', 'timetz', 'bool', 'boolean',
]);

// current_date, now()... sí; current_user, current_schema, session_user... no (metadatos de la base)
const ALLOWED_SQL_VALUE_FUNCTIONS = new Set([
  'SVFOP_CURRENT_DATE', 'SVFOP_CURRENT_TIME', 'SVFOP_CURRENT_TIME_N', 'SVFOP_CURRENT_TIMESTAMP',
  'SVFOP_CURRENT_TIMESTAMP_N', 'SVFOP_LOCALTIME', 'SVFOP_LOCALTIME_N', 'SVFOP_LOCALTIMESTAMP',
  'SVFOP_LOCALTIMESTAMP_N',
]);

// Nodos de expresión/consulta que pueden aparecer. Cualquier otro (INSERT/UPDATE en un WITH, XMLTABLE,
// TABLESAMPLE, $1, definiciones de columnas, JSON_TABLE...) se rechaza por no estar en la lista.
const ALLOWED_NODES = new Set([
  'SelectStmt', 'ResTarget', 'ColumnRef', 'A_Const', 'A_Star', 'A_Expr', 'BoolExpr', 'NullTest',
  'BooleanTest', 'FuncCall', 'TypeCast', 'SubLink', 'RangeVar', 'RangeSubselect', 'RangeFunction',
  'JoinExpr', 'SortBy', 'WindowDef', 'CaseExpr', 'CaseWhen', 'CoalesceExpr', 'MinMaxExpr',
  'String', 'Integer', 'Float', 'Boolean', 'BitString', 'List', 'A_ArrayExpr', 'RowExpr',
  'SQLValueFunction', 'GroupingSet', 'GroupingFunc', 'A_Indirection', 'A_Indices', 'CollateClause',
]);

export const MAX_SQL_LENGTH = 4000;

type AstObject = Record<string, unknown>;

let parserReady: Promise<void> | null = null;
async function ensureParser(): Promise<void> {
  parserReady ??= loadModule().catch((error: unknown) => {
    parserReady = null;
    throw error;
  });
  try {
    await parserReady;
  } catch {
    throw reportUnavailable('El validador de consultas no está disponible. Inténtalo de nuevo');
  }
}

const reject = (reason: string): never => {
  throw queryRejected(`La consulta generada no está permitida (${reason}). Reformula tu pregunta`);
};

function parseStatements(sql: string): unknown[] {
  try {
    return (parseSync(sql) as { stmts?: { stmt: unknown }[] }).stmts?.map((s) => s.stmt) ?? [];
  } catch {
    return reject('no es SQL válido');
  }
}

const nameOf = (node: unknown): string => {
  const value = (node as { String?: { sval?: string } })?.String?.sval;
  return typeof value === 'string' ? value : reject('nombre no reconocido');
};

class AstValidator {
  // scope: nombres de CTE visibles en este punto de la consulta
  walk(value: unknown, scope: ReadonlySet<string>): void {
    if (Array.isArray(value)) {
      for (const item of value) this.walk(item, scope);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const keys = Object.keys(value);
    // Los nodos vienen envueltos como { "TipoDeNodo": { ...campos } }; los campos empiezan en minúscula
    if (keys.length === 1 && /^[A-Z]/.test(keys[0])) {
      this.visitNode(keys[0], (value as AstObject)[keys[0]] as AstObject, scope);
      return;
    }
    for (const key of keys) this.walk((value as AstObject)[key], scope);
  }

  private visitNode(type: string, body: AstObject, scope: ReadonlySet<string>): void {
    switch (type) {
      case 'SelectStmt':
        return this.visitSelect(body, scope);
      case 'RangeVar':
        return this.checkRelation(body, scope);
      case 'FuncCall': {
        this.checkFunction(body);
        const { funcname: _funcname, ...rest } = body;
        return this.walk(rest, scope);
      }
      case 'TypeCast':
        this.checkType(body.typeName);
        return this.walk(body.arg, scope);
      case 'SQLValueFunction':
        if (!ALLOWED_SQL_VALUE_FUNCTIONS.has(String(body.op))) reject('función del sistema no permitida');
        return;
      case 'A_Expr': {
        const parts = ((body.name as unknown[]) ?? []).map(nameOf);
        if (parts.length > 1 && (parts.length !== 2 || parts[0] !== 'pg_catalog')) reject('operador no permitido');
        const { name: _name, ...rest } = body;
        return this.walk(rest, scope);
      }
      default:
        if (!ALLOWED_NODES.has(type)) reject(`elemento SQL no permitido: ${type}`);
        return this.walk(body, scope);
    }
  }

  private visitSelect(body: AstObject, scope: ReadonlySet<string>): void {
    if (body.intoClause) reject('SELECT INTO');
    if (body.lockingClause) reject('bloqueo de filas');

    let inner = scope;
    const withClause = body.withClause as { ctes?: unknown[]; recursive?: boolean } | undefined;
    if (withClause) {
      const ctes = (withClause.ctes ?? []).map((node) => {
        const cte = (node as { CommonTableExpr?: AstObject }).CommonTableExpr;
        if (!cte) return reject('WITH no reconocido');
        const name = String(cte.ctename);
        if (/^pg_/i.test(name)) reject('nombre de WITH reservado');
        if (cte.search_clause || cte.cycle_clause) reject('SEARCH/CYCLE en WITH');
        return { name, query: cte.ctequery, columns: cte.aliascolnames };
      });
      const all = new Set([...scope, ...ctes.map((c) => c.name)]);
      ctes.forEach((cte, index) => {
        // Sin RECURSIVE, una CTE solo ve las anteriores; un nombre posterior sería una tabla real
        const cteScope = withClause.recursive ? all : new Set([...scope, ...ctes.slice(0, index).map((c) => c.name)]);
        const select = (cte.query as { SelectStmt?: AstObject } | undefined)?.SelectStmt;
        if (!select) reject('solo se permite SELECT dentro de WITH');
        this.visitSelect(select as AstObject, cteScope);
        this.walk(cte.columns, cteScope);
      });
      inner = all;
    }

    // UNION / INTERSECT / EXCEPT: los dos lados son SELECT sin envolver
    if (body.larg) this.visitSelect(body.larg as AstObject, inner);
    if (body.rarg) this.visitSelect(body.rarg as AstObject, inner);

    for (const [key, value] of Object.entries(body)) {
      if (key === 'withClause' || key === 'larg' || key === 'rarg') continue;
      this.walk(value, inner);
    }
  }

  private checkRelation(body: AstObject, scope: ReadonlySet<string>): void {
    if (body.schemaname || body.catalogname) reject('no se permiten nombres de schema');
    const name = String(body.relname);
    if (scope.has(name)) return;
    if (!REPORT_VIEWS.has(name)) reject(`vista no permitida: ${name}`);
  }

  private checkFunction(body: AstObject): void {
    const parts = ((body.funcname as unknown[]) ?? []).map(nameOf);
    const name = parts[parts.length - 1]?.toLowerCase();
    // pg_catalog.<f> solo cuando lo genera la sintaxis SQL estándar (EXTRACT, AT TIME ZONE, TRIM...),
    // nunca escrito a mano
    const qualifiedBySyntax = parts.length === 2 && parts[0] === 'pg_catalog' && body.funcformat === 'COERCE_SQL_SYNTAX';
    if (parts.length !== 1 && !qualifiedBySyntax) reject('no se permiten funciones con schema');
    if (!name || !ALLOWED_FUNCTIONS.has(name)) reject(`función no permitida: ${name ?? '?'}`);
  }

  private checkType(typeName: unknown): void {
    const parts = (((typeName as AstObject | undefined)?.names as unknown[]) ?? []).map(nameOf);
    const name = parts[parts.length - 1]?.toLowerCase();
    if (parts.length > 2 || (parts.length === 2 && parts[0] !== 'pg_catalog')) reject('tipo de dato no permitido');
    if (!name || !ALLOWED_TYPES.has(name)) reject(`tipo de dato no permitido: ${name ?? '?'}`);
  }
}

function assertSingleSelect(sql: string): AstObject {
  const statements = parseStatements(sql);
  if (statements.length !== 1) reject(statements.length === 0 ? 'consulta vacía' : 'más de una sentencia');
  const select = (statements[0] as { SelectStmt?: AstObject }).SelectStmt;
  if (!select) return reject('solo se permiten consultas SELECT');
  new AstValidator().walk({ SelectStmt: select }, new Set());
  return select;
}

/** Devuelve el SQL listo para ejecutar o lanza 403 con el motivo. */
export async function validateGeneratedSql(raw: string): Promise<string> {
  await ensureParser();
  // La IA a veces envuelve el SQL en ```sql ... ```
  const sql = raw
    .replace(/^\s*```[a-z]*\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
    .replace(/;+\s*$/, '')
    .trim();

  if (!sql || sql.length > MAX_SQL_LENGTH) reject('consulta vacía o demasiado larga');
  assertSingleSelect(sql);
  assertWrapsAsSingleQuery(sql);
  return sql;
}

// Texto EXACTO que arma report_runtime.run_report() en la base (migración 20261109120000) alrededor de
// la consulta: lo que se valida es lo que se ejecuta.
export const REPORT_WRAPPER_PREFIX = 'SELECT to_json(report_result) FROM (\n';
export const REPORT_WRAPPER_SUFFIX = '\n) AS report_result LIMIT $1';

/**
 * Vuelve a analizar la consulta ya envuelta como la ejecutará la base: debe seguir siendo UNA sentencia
 * `SELECT to_json(...) FROM (<consulta validada>) LIMIT $1`, aunque la consulta original terminara en
 * un comentario o intentara cerrar el paréntesis.
 */
function assertWrapsAsSingleQuery(safeSql: string): void {
  const statements = parseStatements(`${REPORT_WRAPPER_PREFIX}${safeSql}${REPORT_WRAPPER_SUFFIX}`);
  const outer = (statements[0] as { SelectStmt?: AstObject } | undefined)?.SelectStmt;
  const from = outer?.fromClause as { RangeSubselect?: AstObject }[] | undefined;
  const subquery = from?.[0]?.RangeSubselect?.subquery;
  const limitParam = (outer?.limitCount as { ParamRef?: { number?: number } } | undefined)?.ParamRef?.number;
  const target = (outer?.targetList as { ResTarget?: { val?: { FuncCall?: AstObject } } }[] | undefined) ?? [];
  const wrapperFunction = (target[0]?.ResTarget?.val?.FuncCall?.funcname as unknown[] | undefined)?.map(nameOf);
  const allowedOuterKeys = new Set(['targetList', 'fromClause', 'limitCount', 'limitOption', 'op']);
  if (
    statements.length !== 1 ||
    !outer ||
    from?.length !== 1 ||
    !subquery ||
    limitParam !== 1 ||
    target.length !== 1 ||
    wrapperFunction?.join('.') !== 'to_json' ||
    Object.keys(outer).some((key) => !allowedOuterKeys.has(key))
  ) {
    reject('estructura final inesperada');
  }
  new AstValidator().walk(subquery, new Set());
}
