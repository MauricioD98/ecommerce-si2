import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { assertTenantSchema } from '../../tenancy/tenant-context';
import { tableHash, type SchemaSnapshot, type TableManifest } from './backup-format';

// SQL de respaldos sin pg_dump: exportación lógica por schema (filas JSON) y carga con parámetros.
// Ningún texto de un respaldo se ejecuta como SQL: los nombres de tabla y columna se comparan contra el
// catálogo real de PostgreSQL y se validan con un patrón cerrado antes de interpolarse entre comillas.

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const STAGE_RE = /^bkstage_[a-f0-9]{16}$/;

export function qi(name: string): string {
  if (!IDENT_RE.test(name)) throw new Error(`Identificador inválido: ${name}`);
  return `"${name}"`;
}

/** Solo tres familias de schema: tiendas, plano de control y schemas temporales de validación. */
export function qs(schema: string): string {
  if (schema !== 'public' && !STAGE_RE.test(schema)) assertTenantSchema(schema);
  return `"${schema}"`;
}

export class BackupSqlError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface TableInfo {
  name: string;
  columns: string[];
}

export interface ForeignKey {
  table: string;
  columns: string[];
  refTable: string;
  refColumns: string[];
}

export async function schemaExists(c: PoolClient, schema: string): Promise<boolean> {
  const { rows } = await c.query('SELECT 1 FROM pg_namespace WHERE nspname = $1', [schema]);
  return rows.length > 0;
}

export async function listTables(c: PoolClient, schema: string, exclude: readonly string[] = []): Promise<TableInfo[]> {
  const { rows } = await c.query<{ table_name: string; columns: string[] }>(
    `SELECT t.table_name, array_agg(col.column_name::text ORDER BY col.ordinal_position)::text[] AS columns
       FROM information_schema.tables t
       JOIN information_schema.columns col ON col.table_schema = t.table_schema AND col.table_name = t.table_name
      WHERE t.table_schema = $1 AND t.table_type = 'BASE TABLE' AND t.table_name <> '_prisma_migrations'
        AND col.is_generated = 'NEVER'
      GROUP BY t.table_name
      ORDER BY t.table_name`,
    [schema],
  );
  return rows.filter((r) => !exclude.includes(r.table_name)).map((r) => ({ name: r.table_name, columns: r.columns }));
}

export async function listForeignKeys(c: PoolClient, schema: string): Promise<ForeignKey[]> {
  const { rows } = await c.query<{ tbl: string; ref: string; cols: string[]; refcols: string[] }>(
    `SELECT cl.relname::text AS tbl, rf.relname::text AS ref,
            array(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(n, o)
                    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n ORDER BY k.o)::text[] AS cols,
            array(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(n, o)
                    JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.n ORDER BY k.o)::text[] AS refcols
       FROM pg_constraint c
       JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
       JOIN pg_class rf ON rf.oid = c.confrelid JOIN pg_namespace rn ON rn.oid = rf.relnamespace
      WHERE c.contype = 'f' AND n.nspname = $1 AND rn.nspname = $1
      ORDER BY cl.relname, c.conname`,
    [schema],
  );
  return rows.map((r) => ({ table: r.tbl, columns: r.cols, refTable: r.ref, refColumns: r.refcols }));
}

/** Padres antes que hijos (para insertar); las auto-referencias no ordenan. Ciclos → error. */
export function topoOrder(tables: string[], fks: ForeignKey[]): string[] {
  const deps = new Map(tables.map((t) => [t, new Set<string>()]));
  for (const fk of fks) {
    if (fk.table !== fk.refTable && deps.has(fk.table) && deps.has(fk.refTable)) deps.get(fk.table)!.add(fk.refTable);
  }
  const ordered: string[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (t: string) => {
    if (state.get(t) === 'done') return;
    if (state.get(t) === 'visiting') throw new BackupSqlError('BACKUP_SCHEMA_CYCLE', `Dependencia circular entre tablas en ${t}`);
    state.set(t, 'visiting');
    for (const dep of [...deps.get(t)!].sort()) visit(dep);
    state.set(t, 'done');
    ordered.push(t);
  };
  for (const t of [...tables].sort()) visit(t);
  return ordered;
}

export async function appliedMigrations(c: PoolClient, schema: string): Promise<string[]> {
  const { rows } = await c.query<{ migration_name: string }>(
    `SELECT migration_name FROM ${qs(schema)}."_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`,
  );
  return rows.map((r) => r.migration_name);
}

export type RowTransform = (row: Record<string, unknown>) => Record<string, unknown>;

/**
 * Exporta las filas de un schema. Debe correr dentro de una transacción REPEATABLE READ READ ONLY abierta
 * por el llamador: todas las tablas salen de la misma foto. bytea sale como "\x…" (to_jsonb) y vuelve
 * idéntico con json_populate_recordset; fechas, arrays, enums y JSON también hacen el viaje de ida y vuelta.
 */
export async function exportSchema(
  c: PoolClient,
  schema: string,
  options: { exclude?: readonly string[]; transforms?: Record<string, RowTransform> } = {},
): Promise<SchemaSnapshot> {
  const tables = await listTables(c, schema, options.exclude);
  const fks = await listForeignKeys(c, schema);
  const order = topoOrder(tables.map((t) => t.name), fks);
  const byName = new Map(tables.map((t) => [t.name, t]));
  const manifest: TableManifest[] = [];
  const data: Record<string, Record<string, unknown>[]> = {};
  for (const name of order) {
    const table = byName.get(name)!;
    const { rows } = await c.query<{ r: Record<string, unknown> }>(`SELECT to_jsonb(t) AS r FROM ${qs(schema)}.${qi(name)} t ORDER BY t::text`);
    const transform = options.transforms?.[name];
    const out = rows.map((row) => (transform ? transform(row.r) : row.r));
    data[name] = out;
    manifest.push({ name, columns: table.columns, rows: out.length, sha256: tableHash(out) });
  }
  return { migrations: await appliedMigrations(c, schema), tables: manifest, data };
}

/** Misma estructura (tablas y columnas) que el schema destino; si no, la copia no es compatible. */
export async function assertCompatible(c: PoolClient, schema: string, snapshot: SchemaSnapshot, exclude: readonly string[] = []): Promise<void> {
  const current = await appliedMigrations(c, schema);
  if (current.join('\n') !== snapshot.migrations.join('\n')) {
    const missing = snapshot.migrations.filter((m) => !current.includes(m));
    const extra = current.filter((m) => !snapshot.migrations.includes(m));
    throw new BackupSqlError(
      'BACKUP_INCOMPATIBLE_VERSION',
      `Migraciones distintas en ${schema}. Solo en la copia: [${missing.join(', ')}]. Solo en la base: [${extra.join(', ')}]`,
    );
  }
  const tables = new Map((await listTables(c, schema, exclude)).map((t) => [t.name, t.columns]));
  for (const t of snapshot.tables) {
    const columns = tables.get(t.name);
    if (!columns) throw new BackupSqlError('BACKUP_INCOMPATIBLE_VERSION', `La tabla ${t.name} no existe en ${schema}`);
    const missing = t.columns.filter((col) => !columns.includes(col));
    if (missing.length) throw new BackupSqlError('BACKUP_INCOMPATIBLE_VERSION', `Columnas inexistentes en ${t.name}: ${missing.join(', ')}`);
  }
  for (const name of tables.keys()) {
    if (!snapshot.tables.some((t) => t.name === name)) {
      throw new BackupSqlError('BACKUP_INCOMPATIBLE_VERSION', `La tabla ${name} de ${schema} no está en la copia`);
    }
  }
}

const BATCH_ROWS = 500;

/** INSERT con parámetros (json_populate_recordset): los valores nunca se interpolan en el SQL. */
export async function insertRows(
  c: PoolClient,
  schema: string,
  table: string,
  columns: string[],
  rows: Record<string, unknown>[],
  onConflict = '',
): Promise<number> {
  if (rows.length === 0) return 0;
  const cols = columns.map(qi).join(', ');
  const target = `${qs(schema)}.${qi(table)}`;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_ROWS) {
    const batch = rows.slice(i, i + BATCH_ROWS);
    const res = await c.query(
      `INSERT INTO ${target} (${cols}) SELECT ${cols} FROM json_populate_recordset(NULL::${target}, $1::json) ${onConflict}`,
      [JSON.stringify(batch)],
    );
    inserted += res.rowCount ?? 0;
  }
  return inserted;
}

export function newStageSchema(): string {
  return `bkstage_${randomBytes(8).toString('hex')}`;
}

/**
 * Validación aislada: clona la estructura del schema destino (columnas, defaults, CHECK, índices únicos y
 * claves foráneas) en un schema temporal y carga ahí las filas de la copia. Corre dentro de una
 * transacción que el llamador SIEMPRE revierte: el schema temporal no llega a existir para nadie más y los
 * datos actuales no se tocan. Detecta filas que violan tipos, NOT NULL, unicidad o referencias.
 */
export async function validateInStage(c: PoolClient, sourceSchema: string, snapshot: SchemaSnapshot): Promise<string> {
  const stage = newStageSchema();
  await c.query(`CREATE SCHEMA ${qs(stage)}`);
  const names = snapshot.tables.map((t) => t.name);
  for (const name of names) {
    await c.query(
      `CREATE TABLE ${qs(stage)}.${qi(name)} (LIKE ${qs(sourceSchema)}.${qi(name)} INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`,
    );
  }
  for (const fk of await listForeignKeys(c, sourceSchema)) {
    if (!names.includes(fk.table) || !names.includes(fk.refTable)) continue;
    await c.query(
      `ALTER TABLE ${qs(stage)}.${qi(fk.table)} ADD FOREIGN KEY (${fk.columns.map(qi).join(', ')})
         REFERENCES ${qs(stage)}.${qi(fk.refTable)} (${fk.refColumns.map(qi).join(', ')})`,
    );
  }
  for (const table of snapshot.tables) {
    const loaded = await insertRows(c, stage, table.name, table.columns, snapshot.data[table.name]);
    if (loaded !== table.rows) throw new BackupSqlError('BACKUP_VALIDATION_FAILED', `Validación: ${table.name} cargó ${loaded} de ${table.rows} filas`);
  }
  return stage;
}

export async function countRows(c: PoolClient, schema: string, table: string): Promise<number> {
  const { rows } = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${qs(schema)}.${qi(table)}`);
  return rows[0].n;
}
