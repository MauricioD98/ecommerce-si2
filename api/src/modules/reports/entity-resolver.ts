import { queryRejected } from './report-errors';

// Nombres de sucursales, productos y categorías en los reportes con IA.
//
// La IA NO escribe nombres en el SQL: escribe marcadores {{sucursal:texto}}, {{producto:texto}} o
// {{categoria:texto}} con las palabras del usuario. El servidor los resuelve contra las opciones que el
// usuario PUEDE ver (se consultan con el mismo rol y ámbito que el reporte) y los reemplaza por el id.
// Si hay varias coincidencias se pide aclaración; nunca se elige una al azar.

export type EntityKind = 'sucursal' | 'producto' | 'categoria';

export interface Placeholder {
  /** Texto exacto del marcador en el SQL, p. ej. "{{producto: set deportivo}}" */
  raw: string;
  kind: EntityKind;
  text: string;
}

export interface Candidate {
  id: string;
  name: string;
  /** SKU del producto (también se acepta como nombre) */
  code?: string | null;
}

export type Resolution =
  | { status: 'ok'; id: string; name: string; method: 'exacto' | 'parcial' | 'aproximado' }
  | { status: 'ambiguous'; options: Candidate[] }
  | { status: 'not_found' };

const PLACEHOLDER_RE = /\{\{\s*(sucursal|producto|categoria)\s*:\s*([^{}\n]{1,80}?)\s*\}\}/gi;
const MAX_OPTIONS = 10;

const STOPWORDS: Record<EntityKind, Set<string>> = {
  sucursal: new Set(['sucursal', 'sucursales', 'tienda', 'local', 'agencia', 'la', 'el', 'de', 'del', 'los', 'las']),
  producto: new Set(['producto', 'el', 'la', 'los', 'las', 'de', 'del', 'un', 'una']),
  categoria: new Set(['categoria', 'categorias', 'rubro', 'linea', 'la', 'el', 'de', 'del', 'los', 'las']),
};

export function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Singular aproximado: "blusas" -> "blusa", "pantalones" -> "pantalon"
const stem = (token: string) => (token.length > 4 && token.endsWith('es') ? token.slice(0, -2) : token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token);

function tokensOf(kind: EntityKind, value: string): string[] {
  return normalizeName(value)
    .split(' ')
    .filter((t) => t && !STOPWORDS[kind].has(t))
    .map(stem);
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = temp;
    }
  }
  return prev[b.length];
}
const similarity = (a: string, b: string) => 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1);

const unique = (list: Candidate[]) => [...new Map(list.map((c) => [c.id, c])).values()];

export function resolveEntity(kind: EntityKind, text: string, candidates: Candidate[]): Resolution {
  const query = tokensOf(kind, text);
  const prepared = candidates.map((c) => ({ c, tokens: tokensOf(kind, c.name), code: c.code ? normalizeName(c.code) : null }));
  const pick = (list: Candidate[], method: 'exacto' | 'parcial' | 'aproximado'): Resolution => {
    const distinct = unique(list);
    return distinct.length === 1
      ? { status: 'ok', id: distinct[0].id, name: distinct[0].name, method }
      : { status: 'ambiguous', options: distinct.slice(0, MAX_OPTIONS) };
  };

  // Sin palabras útiles ("{{sucursal:sucursal}}"): hay que preguntar cuál
  if (query.length === 0) {
    return candidates.length === 1 ? pick(candidates, 'parcial') : { status: 'ambiguous', options: unique(candidates).slice(0, MAX_OPTIONS) };
  }

  // 1) Igual (sin mayúsculas, tildes ni palabras genéricas), o el SKU exacto
  const key = query.join(' ');
  const rawKey = normalizeName(text);
  const exact = prepared.filter((p) => p.tokens.join(' ') === key || (p.code !== null && p.code === rawKey)).map((p) => p.c);
  if (exact.length > 0) return pick(exact, 'exacto');

  // 2) Todas las palabras dichas aparecen (como palabra o comienzo de palabra) en el nombre
  const partial = prepared.filter((p) => query.every((q) => p.tokens.some((t) => t.startsWith(q)))).map((p) => p.c);
  if (partial.length > 0) return pick(partial, 'parcial');

  // 3) Aproximado (errores de dictado o de tipeo): similitud por palabra en LOS DOS sentidos, para que
  //    las palabras que sobran en el nombre ("Set Deportivo Niña" frente a "set deportibo") resten
  const scored = prepared
    .map((p) => {
      const best = query.map((q) => Math.max(0, ...p.tokens.map((t) => similarity(q, t))));
      const back = p.tokens.map((t) => Math.max(0, ...query.map((q) => similarity(q, t))));
      const all = [...best, ...back];
      return { c: p.c, score: all.reduce((a, b) => a + b, 0) / all.length, top: Math.max(...best) };
    })
    .filter((s) => s.score >= 0.6 && s.top >= 0.8)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return { status: 'not_found' };
  const close = scored.filter((s) => scored[0].score - s.score < 0.1).map((s) => s.c);
  return pick(close, 'aproximado');
}

export function extractPlaceholders(sql: string): Placeholder[] {
  const found: Placeholder[] = [];
  const rest = sql.replace(PLACEHOLDER_RE, (raw, kind: string, text: string) => {
    found.push({ raw, kind: kind.toLowerCase() as EntityKind, text: text.trim() });
    return ' ';
  });
  if (rest.includes('{{') || rest.includes('}}')) {
    throw queryRejected('La consulta generada no está permitida (marcador de nombre no válido). Reformula tu pregunta');
  }
  return found;
}

const quoteLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** Reemplaza cada marcador por el id resuelto (literal SQL). */
export function substitutePlaceholders(sql: string, ids: Map<string, string>): string {
  return sql.replace(PLACEHOLDER_RE, (raw) => {
    const id = ids.get(raw);
    if (id === undefined) throw queryRejected('La consulta generada no está permitida (marcador sin resolver). Reformula tu pregunta');
    return quoteLiteral(id);
  });
}

const LABELS: Record<EntityKind, { one: string; many: string; scope: (branchScoped: boolean) => string }> = {
  sucursal: {
    one: 'la sucursal',
    many: 'varias sucursales',
    scope: (branchScoped) => (branchScoped ? 'las sucursales a las que tienes acceso' : 'las sucursales de la tienda'),
  },
  producto: { one: 'el producto', many: 'varios productos', scope: () => 'los productos del catálogo' },
  categoria: { one: 'la categoría', many: 'varias categorías', scope: () => 'las categorías de la tienda' },
};

export function describeOption(kind: EntityKind, c: Candidate): string {
  return kind === 'producto' && c.code ? `${c.name} (${c.code})` : c.name;
}

export function ambiguousMessage(kind: EntityKind, text: string, options: Candidate[]): string {
  return `Encontré ${LABELS[kind].many} que coinciden con «${text}»: ${options.map((o) => describeOption(kind, o)).join(', ')}. ¿A cuál te refieres?`;
}

export function notFoundMessage(kind: EntityKind, text: string, branchScoped: boolean): string {
  return `No encontré ${LABELS[kind].one} «${text}» entre ${LABELS[kind].scope(branchScoped)}.`;
}
