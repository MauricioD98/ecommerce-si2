// Formato de los resultados de Reportes → IA. Funciones puras (sin React) para poder probarlas aparte.
//
// FECHAS: la API devuelve las fechas como texto ISO con el desfase de la zona del reporte
// ("2026-11-08T14:36:55.281-04:00", ya en hora de la tienda). Se formatean con Intl en ESA zona
// (interpretation.zonaHoraria), nunca en la del navegador ni sumando desfases a mano: así la hora no se
// convierte dos veces. Las fechas sin hora ("2026-11-07") y las horas sin zona se muestran tal cual
// (componentes del texto), porque `new Date("2026-11-07")` es medianoche UTC y en Bolivia sería el día 6.

export type ColumnKind = 'datetime' | 'date' | 'month' | 'money' | 'count' | 'percent' | 'number' | 'reference' | 'boolean' | 'enum' | 'text';

export interface FormatContext {
    /** Etiqueta BCP 47: es-BO, en-US, fr-FR, zh-CN */
    locale: string;
    /** Zona IANA del reporte (America/La_Paz) */
    timeZone: string;
    /** Moneda de los importes (BOB) */
    currency: string;
}

const ISO_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}(?::?\d{2})?)?$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MONTH = /^(\d{4})-(\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CUID = /^c[a-z0-9]{20,32}$/;
// Siglas que no se pasan a "Título"
const ACRONYMS = new Set(['POS', 'WEB', 'BOB', 'USD', 'USDT', 'QR', 'NIT', 'SKU', 'ID', 'BANK_QR', 'PICKUP', 'DELIVERY']);

const isMoneyName = (name: string) =>
    /(importe|monto|total|precio|subtotal|ingreso|neto|neta|bruto|bruta|devuelto|devoluciones|costo|descuento|recaudado|cobrado|facturado|valor|ticket)/.test(name);
const isCountName = (name: string) =>
    /(^|_)(cantidad|cant|numero|nro|num|n|unidades|pedidos|ventas|transacciones|count|conteo|clientes|empleados|productos|items|lineas|filas|dias)(_|$)/.test(name) &&
    !/(importe|monto|precio|ticket_promedio|promedio_venta)/.test(name);

/** Tipo de una columna a partir de su nombre y de sus valores no nulos. */
export function columnKind(name: string, values: unknown[]): ColumnKind {
    const lower = name.toLowerCase();
    const present = values.filter((v) => v !== null && v !== undefined);
    if (present.length === 0) return /(_id$|^id$)/.test(lower) ? 'reference' : 'text';
    if (present.every((v) => typeof v === 'boolean')) return 'boolean';
    if (present.every((v) => typeof v === 'number')) {
        if (/(porcentaje|pct|porc|tasa)/.test(lower)) return 'percent';
        if (isCountName(lower) && !/(total_ventas|ventas_(brutas|netas))/.test(lower)) return 'count';
        if (isMoneyName(lower)) return 'money';
        return 'number';
    }
    if (present.every((v) => typeof v === 'string')) {
        const strings = present as string[];
        if (/(^id$|_id$|^order_number$|^numero_(pedido|venta|devolucion|orden)$|^referencia|transaccion)/.test(lower) || strings.every((s) => UUID.test(s) || CUID.test(s))) {
            return 'reference';
        }
        if (strings.every((s) => ISO_DATETIME.test(s))) return 'datetime';
        if (strings.every((s) => ISO_DATE.test(s))) return 'date';
        if (strings.every((s) => ISO_MONTH.test(s))) return 'month';
        if (strings.every((s) => /^[A-Z][A-Z0-9_]{1,40}$/.test(s))) return 'enum';
    }
    return 'text';
}

// Palabras sin tilde que suelen venir en los alias que escribe la IA (snake_case sin acentos)
const ACCENTS: Record<string, string> = {
    numero: 'número', categoria: 'categoría', categorias: 'categorías', telefono: 'teléfono', devolucion: 'devolución',
    metodo: 'método', transaccion: 'transacción', transacciones: 'transacciones', razon: 'razón', codigo: 'código',
    ultimo: 'último', ultima: 'última', dia: 'día', dias: 'días', anio: 'año', credito: 'crédito', informacion: 'información',
    direccion: 'dirección', ubicacion: 'ubicación', descripcion: 'descripción', promocion: 'promoción', comision: 'comisión',
    condicion: 'condición', envio: 'envío', unico: 'único', minimo: 'mínimo', maximo: 'máximo', periodo: 'período',
    region: 'región', operacion: 'operación', facturacion: 'facturación', creacion: 'creación', ano: 'año',
    actualizacion: 'actualización', medio: 'medio', genero: 'género', ultimos: 'últimos', mas: 'más', estadistica: 'estadística',
    promedio: 'promedio', articulo: 'artículo', articulos: 'artículos', cajero: 'cajero', rapido: 'rápido',
};
const UPPER_WORDS: Record<string, string> = { nit: 'NIT', sku: 'SKU', pos: 'POS', web: 'web', id: 'ID', usdt: 'USDT', bob: 'BOB' };

/**
 * Nombre legible de una columna. Los alias los escribe la IA en español: se separan, se acentúan y se
 * capitaliza la primera palabra. `known` permite traducir nombres frecuentes en los otros idiomas.
 */
export function columnLabel(name: string, known: Record<string, string> = {}): string {
    const key = name.toLowerCase();
    if (known[key]) return known[key];
    const words = key.split(/[_\s]+/).filter(Boolean).map((w) => UPPER_WORDS[w] ?? ACCENTS[w] ?? w);
    if (words.length === 0) return name;
    const [first, ...rest] = words;
    return [first === first.toUpperCase() ? first : first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ');
}

/** "BLOQUEADO_TEMPORALMENTE" -> "Bloqueado temporalmente" (las siglas quedan igual). */
export function enumLabel(value: string): string {
    if (ACRONYMS.has(value)) return value;
    const words = value.toLowerCase().split('_').map((w) => ACCENTS[w] ?? w);
    const text = words.join(' ');
    return text.charAt(0).toUpperCase() + text.slice(1);
}

const hour12For = (locale: string) => !locale.startsWith('fr');

export interface DateTimeParts {
    date: string;
    time: string | null;
}

/** Fecha y hora por separado, en la zona del reporte (o tal cual si el texto no trae zona). */
export function dateTimeParts(value: string, ctx: FormatContext, style: 'long' | 'short' = 'long'): DateTimeParts | null {
    const dt = ISO_DATETIME.exec(value);
    const dateOnly = ISO_DATE.exec(value);
    if (!dt && !dateOnly) return null;
    const dateOpts: Intl.DateTimeFormatOptions =
        style === 'long' ? { day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'short', year: 'numeric' };
    const timeOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', hour12: hour12For(ctx.locale) };

    if (dateOnly) {
        const civil = new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])));
        return { date: new Intl.DateTimeFormat(ctx.locale, { ...dateOpts, timeZone: 'UTC' }).format(civil), time: null };
    }
    const [, y, mo, d, h, mi, s, zone] = dt!;
    // Con zona: un instante absoluto, mostrado en la zona del reporte. Sin zona: hora local ya resuelta.
    const instant = zone ? new Date(value.replace(' ', 'T')) : new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? 0)));
    const timeZone = zone ? ctx.timeZone : 'UTC';
    if (Number.isNaN(instant.getTime())) return null;
    return {
        date: new Intl.DateTimeFormat(ctx.locale, { ...dateOpts, timeZone }).format(instant),
        time: new Intl.DateTimeFormat(ctx.locale, { ...timeOpts, timeZone }).format(instant),
    };
}

/**
 * Columnas de fecha-hora cuyos valores caen TODOS a las 00:00:00 en la zona del reporte (date_trunc('day'),
 * ::date convertido...) se muestran como fecha: "6 de noviembre de 2026" y no "6 nov 2026, 12:00 a. m.".
 */
export function refineKind(kind: ColumnKind, values: unknown[], ctx: FormatContext): ColumnKind {
    if (kind !== 'datetime') return kind;
    const present = values.filter((v): v is string => typeof v === 'string');
    return present.length > 0 && present.every((v) => localTimestamp(v, ctx).endsWith(' 00:00:00')) ? 'date' : kind;
}

/** Fecha y hora en la zona del reporte como texto plano para Excel/CSV: "2026-11-08 14:36:55". */
export function localTimestamp(value: string, ctx: FormatContext): string {
    const dt = ISO_DATETIME.exec(value);
    if (!dt) return value;
    if (!dt[7]) return value.replace('T', ' ').replace(/\.\d+$/, '');
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-CA', {
            timeZone: ctx.timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23',
        })
            .formatToParts(new Date(value))
            .map((p) => [p.type, p.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export function formatMoneyValue(value: number, ctx: FormatContext): string {
    const amount = value.toLocaleString(ctx.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    // Bolivianos con el mismo estilo que el resto de la tienda ("Bs 1.234,50"); otras monedas con su código
    return ctx.currency === 'BOB' ? `Bs ${amount}` : `${ctx.currency} ${amount}`;
}

/** Referencia abreviada para mostrar: "cmw86c2n…" (el valor completo se copia aparte). */
export const shortReference = (value: string) => (value.length > 10 ? `${value.slice(0, 8)}…` : value);

export interface Labels {
    yes: string;
    no: string;
    empty: string;
}

/** Texto para una celda de tabla o para el PDF. `fullReferences` = sin abreviar (PDF). */
export function formatValue(kind: ColumnKind, value: unknown, ctx: FormatContext, labels: Labels, fullReferences = false): string {
    if (value === null || value === undefined || value === '') return labels.empty;
    switch (kind) {
        case 'datetime': {
            const parts = dateTimeParts(String(value), ctx, 'short');
            return parts ? (parts.time ? `${parts.date}, ${parts.time}` : parts.date) : String(value);
        }
        case 'date':
            // Fecha sin hora ("2026-11-07") o instante a medianoche local (agrupaciones por día)
            return dateTimeParts(String(value), ctx, 'long')?.date ?? String(value);
        case 'month': {
            const m = ISO_MONTH.exec(String(value));
            return m
                ? new Intl.DateTimeFormat(ctx.locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(+m[1], +m[2] - 1, 1)))
                : String(value);
        }
        case 'money':
            return typeof value === 'number' ? formatMoneyValue(value, ctx) : String(value);
        case 'count':
            return typeof value === 'number' ? value.toLocaleString(ctx.locale, { maximumFractionDigits: 2 }) : String(value);
        case 'percent':
            return typeof value === 'number' ? `${value.toLocaleString(ctx.locale, { maximumFractionDigits: 2 })} %` : String(value);
        case 'number':
            return typeof value === 'number' ? value.toLocaleString(ctx.locale, { maximumFractionDigits: 2 }) : String(value);
        case 'reference':
            return fullReferences ? String(value) : shortReference(String(value));
        case 'boolean':
            return value ? labels.yes : labels.no;
        case 'enum':
            return enumLabel(String(value));
        default:
            return typeof value === 'object' ? JSON.stringify(value) : String(value);
    }
}

/** Valor para Excel/CSV: números como números (sin redondear), fechas en hora local legible, resto tal cual. */
export function exportValue(kind: ColumnKind, value: unknown, ctx: FormatContext, labels: Labels): unknown {
    if (value === null || value === undefined) return null;
    if (kind === 'datetime') return localTimestamp(String(value), ctx);
    if (kind === 'date' && ISO_DATETIME.test(String(value))) return localTimestamp(String(value), ctx).slice(0, 10);
    if (kind === 'boolean') return value ? labels.yes : labels.no;
    return value;
}

// Une los resultados de la Web Speech API sin duplicar texto. Chrome de escritorio entrega fragmentos
// (" de todos" tras "dame la lista"); Chrome de Android, con resultados intermedios, entrega cada
// resultado con TODO lo anterior ("dame la lista", "dame la lista de todos"): unirlos duplicaba la frase.
export function mergeSpeechResults(transcripts: string[]): string {
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    let text = '';
    for (const raw of transcripts) {
        const piece = raw.replace(/\s+/g, ' ').trim();
        if (!piece) continue;
        if (!text || norm(piece).startsWith(norm(text))) text = piece; // acumulado (Android)
        else if (norm(text).endsWith(norm(piece))) continue; // fragmento repetido
        else text = `${text} ${piece}`;
    }
    return text;
}

/** Agrega lo dictado a lo que ya estaba escrito, sin repetirlo si el dictado ya lo incluye. */
export function appendDictation(prefix: string, dictated: string): string {
    const base = prefix.trim();
    const spoken = dictated.trim();
    if (!base) return spoken;
    if (!spoken) return base;
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ');
    if (norm(spoken).startsWith(norm(base))) return spoken;
    if (norm(base).endsWith(norm(spoken))) return base;
    return `${base} ${spoken}`;
}
