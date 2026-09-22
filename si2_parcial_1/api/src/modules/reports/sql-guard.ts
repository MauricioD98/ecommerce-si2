import { ForbiddenException } from '@nestjs/common';

// Validación del SQL que devuelve la IA. ES SOLO UNA CAPA: el aislamiento real lo da la base de datos
// (rol de solo lectura + vistas del esquema "reporting" con el filtro de sucursal). Esta validación
// existe sobre todo para que la consulta no pueda cambiar ese filtro ni salirse de las vistas.

// Palabras que nunca deben aparecer (además de DROP, DELETE, UPDATE, INSERT y ALTER)
const FORBIDDEN_KEYWORDS = [
  'drop', 'delete', 'update', 'insert', 'alter', 'truncate', 'create', 'grant', 'revoke', 'copy',
  'execute', 'call', 'do', 'set', 'reset', 'show', 'listen', 'notify', 'vacuum', 'analyze', 'merge',
  'into', 'lock', 'comment', 'refresh', 'prepare', 'declare', 'fetch', 'load', 'begin', 'commit',
  'rollback', 'savepoint', 'security', 'public',
];

// Referencias a objetos internos de PostgreSQL
const FORBIDDEN_PATTERNS: RegExp[] = [/\bpg_\w*/i, /\binformation_schema\b/i, /\bset_config\b/i, /\bcurrent_setting\b/i, /\bdblink\b/i];

// Únicas funciones que la consulta puede llamar. Cualquier otra (set_config, query_to_xml, pg_read_file...)
// se rechaza: así una consulta no puede alterar la variable de sesión que limita la sucursal.
const ALLOWED_FUNCTIONS = new Set([
  'count', 'sum', 'avg', 'min', 'max', 'coalesce', 'nullif', 'greatest', 'least', 'round', 'ceil', 'ceiling',
  'floor', 'abs', 'date_trunc', 'date_part', 'extract', 'to_char', 'now', 'lower', 'upper', 'trim', 'length',
  'substring', 'concat', 'replace', 'position', 'row_number', 'rank', 'dense_rank', 'lag', 'lead',
  'generate_series', 'string_agg', 'age', 'date', 'cast',
  // tipos en conversiones: CAST(x AS numeric(10,2))
  'numeric', 'decimal', 'varchar', 'char', 'timestamp', 'integer', 'bigint',
]);

// Palabras SQL que pueden ir seguidas de "(" sin ser una llamada a función
const KEYWORDS_BEFORE_PAREN = new Set([
  'and', 'or', 'not', 'in', 'exists', 'any', 'all', 'some', 'over', 'filter', 'values', 'as', 'on', 'using',
  'from', 'join', 'where', 'select', 'with', 'union', 'intersect', 'except', 'distinct', 'by', 'having',
  'when', 'then', 'else', 'case', 'between', 'like', 'ilike', 'partition', 'order', 'group', 'limit',
  'offset', 'lateral', 'within', 'array', 'row', 'is', 'end', 'inner', 'left', 'right', 'full', 'cross',
  'outer', 'recursive', 'materialized', 'rows', 'range',
]);

export const MAX_SQL_LENGTH = 4000;

export function validateGeneratedSql(raw: string): string {
  // La IA a veces envuelve el SQL en ```sql ... ```
  let sql = raw
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
    .replace(/;+\s*$/, '')
    .trim();

  const reject = (reason: string): never => {
    throw new ForbiddenException(`La consulta generada no está permitida (${reason}). Reformula tu pregunta`);
  };

  if (!sql || sql.length > MAX_SQL_LENGTH) reject('consulta vacía o demasiado larga');

  // Solo una sentencia, sin comentarios, identificadores entrecomillados, dollar-quoting ni escapes
  if (sql.includes(';')) reject('más de una sentencia');
  if (/--|\/\*/.test(sql)) reject('comentarios');
  if (/["\\$]/.test(sql) || /u&/i.test(sql)) reject('caracteres no permitidos');

  // Solo SELECT (o WITH ... SELECT)
  if (!/^\s*(select|with)\b/i.test(sql)) reject('solo se permiten consultas SELECT');

  const lowered = sql.toLowerCase();
  for (const keyword of FORBIDDEN_KEYWORDS) {
    if (new RegExp(`\\b${keyword}\\b`, 'i').test(lowered)) reject(`palabra prohibida: ${keyword.toUpperCase()}`);
  }
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(sql)) reject('acceso a objetos internos');
  }

  // Lista blanca de funciones
  for (const match of lowered.matchAll(/\b([a-z_][a-z0-9_]*)\s*\(/g)) {
    const name = match[1];
    if (!ALLOWED_FUNCTIONS.has(name) && !KEYWORDS_BEFORE_PAREN.has(name)) {
      reject(`función no permitida: ${name}`);
    }
  }

  return sql;
}
