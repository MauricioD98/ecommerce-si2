// Exportación de Reportes → IA a Excel y PDF con formato de informe corporativo.
//
// Solo da FORMATO: recibe las filas que ya devolvió la consulta (sin tocarlas) y las presenta igual en
// los dos formatos: banda de título, banda de información, consulta por voz, tarjetas de resumen (KPIs)
// y una tabla por grupo con subtítulo, encabezado, filas en cebra y fila de totales.
// Sin imports de React ni alias "@/" para poder generarlo y probarlo fuera del navegador.

import type { Workbook, Worksheet, Cell, Fill, Font, Borders, Alignment } from 'exceljs';
import type { jsPDF as JsPdf } from 'jspdf';
import { enumLabel, localTimestamp, type ColumnKind, type FormatContext, type Labels } from './reportFormat';

// ───────────────────────────── Paleta ─────────────────────────────

export const REPORT_PRIMARY = '#1F3864'; // azul marino
const ROTATION = ['#2F5597', '#44546A', '#1D5C63']; // azul acero, gris pizarra, verde petróleo
const TEXT = '#212121';
const MUTED = '#7F7F7F';
const WHITE = '#FFFFFF';

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb;
}
const rgbToHex = (rgb: Rgb) => '#' + rgb.map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('').toUpperCase();
/** Mezcla con blanco: lighten(c, 0.92) = 92 % más claro. */
export const lighten = (hex: string, amount: number) => rgbToHex(hexToRgb(hex).map((c) => c + (255 - c) * amount) as Rgb);
/** Mezcla con negro: darken(c, 0.3) = 30 % más oscuro. */
export const darken = (hex: string, amount: number) => rgbToHex(hexToRgb(hex).map((c) => c * (1 - amount)) as Rgb);

const isHexColor = (value: string | undefined): value is string => !!value && /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);

/** Colores de la rotación: 0 = principal (del tenant o azul marino), luego acero, pizarra y petróleo. */
export function paletteColor(index: number, primary = REPORT_PRIMARY): string {
    const colors = [primary, ...ROTATION];
    return colors[index % colors.length];
}

interface Tone {
    base: string;
    header: string; // encabezado de columnas (~20 % más claro)
    zebra: string; // filas alternas (~92 % más claro)
    total: string; // fondo de la fila de totales (~80 % más claro)
    totalText: string; // texto de totales (~30 % más oscuro)
    border: string; // bordes finos (~65 % más claro)
}
const tone = (base: string): Tone => ({
    base,
    header: lighten(base, 0.2),
    zebra: lighten(base, 0.92),
    total: lighten(base, 0.8),
    totalText: darken(base, 0.3),
    border: lighten(base, 0.65),
});

// ───────────────────────────── Modelo del informe ─────────────────────────────

export interface ReportColumn {
    key: string;
    label: string;
    kind: ColumnKind;
}

export interface ReportSection {
    title: string;
    columns: ReportColumn[];
    rows: Record<string, unknown>[];
}

export interface ReportKpi {
    label: string;
    kind: ColumnKind;
    value: unknown;
}

export interface ReportDocument {
    title: string;
    store: string;
    period: string;
    user: string;
    generatedAt: Date;
    /** Texto original dictado; si falta, no se muestra la línea "Consulta por voz". */
    voiceQuery?: string;
    kpis: ReportKpi[];
    sections: ReportSection[];
    ctx: FormatContext;
    labels: Labels;
    /** Color principal del tenant (opcional). Por defecto #1F3864. */
    primaryColor: string;
    /** Valores de porcentaje que vienen en puntos (15 = 15 %) en vez de fracción, por columna. */
    percentInPoints: Set<string>;
}

export interface BuildReportOptions {
    title: string;
    store: string;
    period?: string[];
    user?: string;
    voiceQuery?: string;
    generatedAt?: Date;
    primaryColor?: string;
    /** Fuerza la columna de agrupación (si no, se detecta). null = nunca agrupar. */
    groupBy?: string | null;
}

const DIMENSION_KINDS: ColumnKind[] = ['text', 'enum', 'month', 'date', 'boolean'];
const NUMERIC_KINDS: ColumnKind[] = ['money', 'count', 'number', 'percent'];

/** Columna por la que viene agrupado el resultado: la primera dimensión cuyos valores se repiten. */
export function detectGroupColumn(columns: ReportColumn[], rows: Record<string, unknown>[]): ReportColumn | null {
    if (columns.length < 3 || rows.length < 2) return null;
    for (const column of columns) {
        if (!DIMENSION_KINDS.includes(column.kind)) continue;
        const distinct = new Set(rows.map((r) => String(r[column.key] ?? ''))).size;
        if (distinct >= 2 && distinct < rows.length && distinct <= 50) return column;
        return null; // solo la primera dimensión cuenta como agrupación
    }
    return null;
}

/** Arma el informe a partir del resultado (las filas no se modifican, solo se reparten por grupo). */
export function buildReportDocument(
    rows: Record<string, unknown>[],
    columns: ReportColumn[],
    ctx: FormatContext,
    labels: Labels,
    options: BuildReportOptions,
): ReportDocument {
    const percentInPoints = new Set(
        columns.filter((c) => c.kind === 'percent' && rows.some((r) => typeof r[c.key] === 'number' && Math.abs(r[c.key] as number) > 1)).map((c) => c.key),
    );
    const base = {
        title: options.title,
        store: options.store,
        period: options.period && options.period.length > 0 ? options.period.join(' · ') : 'Todo el período disponible',
        user: options.user || '—',
        generatedAt: options.generatedAt ?? new Date(),
        voiceQuery: options.voiceQuery,
        ctx,
        labels,
        primaryColor: isHexColor(options.primaryColor) ? (options.primaryColor.startsWith('#') ? options.primaryColor : `#${options.primaryColor}`) : REPORT_PRIMARY,
        percentInPoints,
    };

    // Una sola fila con pocas columnas: tarjetas de resumen, una por columna (como en pantalla)
    if (rows.length === 1 && columns.length <= 6) {
        return { ...base, kpis: columns.map((c) => ({ label: c.label, kind: c.kind, value: rows[0][c.key] })), sections: [] };
    }

    const group =
        options.groupBy === null ? null : options.groupBy ? (columns.find((c) => c.key === options.groupBy) ?? null) : detectGroupColumn(columns, rows);
    if (!group) return { ...base, kpis: [], sections: [{ title: 'Detalle', columns, rows }] };

    const tableColumns = columns.filter((c) => c.key !== group.key);
    const groups = new Map<string, Record<string, unknown>[]>();
    const firstValue = new Map<string, unknown>();
    for (const row of rows) {
        const id = String(row[group.key] ?? '');
        if (!groups.has(id)) {
            groups.set(id, []);
            firstValue.set(id, row[group.key]);
        }
        groups.get(id)!.push(row);
    }
    const sections = [...groups.entries()].map(([id, groupRows]) => ({
        title: `${group.label}: ${displayText(group, firstValue.get(id), base as ReportDocument)}`,
        columns: tableColumns,
        rows: groupRows,
    }));
    return { ...base, kpis: [], sections };
}

// ───────────────────────────── Valores y formatos ─────────────────────────────

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MONTH = /^(\d{4})-(\d{2})$/;
const pad = (n: number) => String(n).padStart(2, '0');

/** Número al estilo boliviano: 1.234,56 */
export function formatBo(value: number, decimals: number): string {
    // Redondeo decimal (como Excel): toFixed redondea 17,85 a "17,8" por la representación binaria
    const rounded = Number(`${Math.round(Number(`${Math.abs(value)}e${decimals}`) + 1e-9)}e-${decimals}`);
    const [int, dec] = rounded.toFixed(decimals).split('.');
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${value < 0 && rounded !== 0 ? '-' : ''}${grouped}${dec ? `,${dec}` : ''}`;
}

const currencyPrefix = (ctx: FormatContext) => (ctx.currency === 'BOB' ? 'Bs' : ctx.currency);

/** Fecha civil (componentes en UTC) de un valor de fecha/hora, ya en la hora local del reporte. */
function civilDate(kind: ColumnKind, raw: unknown, ctx: FormatContext): Date | null {
    if (typeof raw !== 'string') return null;
    if (kind === 'month') {
        const m = ISO_MONTH.exec(raw);
        return m ? new Date(Date.UTC(+m[1], +m[2] - 1, 1)) : null;
    }
    const d = ISO_DATE.exec(raw);
    if (d) return new Date(Date.UTC(+d[1], +d[2] - 1, +d[3]));
    const local = localTimestamp(raw, ctx); // "2026-11-08 14:36:55"
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):?(\d{2})?/.exec(local);
    if (!m) return null;
    return kind === 'date'
        ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
        : new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)));
}

/** Valor que se guarda en la celda de Excel (número, fecha real o texto). */
function sheetValue(column: Pick<ReportColumn, 'key' | 'kind'>, raw: unknown, doc: ReportDocument): string | number | Date | null {
    if (raw === null || raw === undefined || raw === '') return null;
    const { kind } = column;
    if (kind === 'datetime' || kind === 'date' || kind === 'month') return civilDate(kind, raw, doc.ctx) ?? String(raw);
    if (kind === 'percent' && typeof raw === 'number') return doc.percentInPoints.has(column.key) ? raw / 100 : raw;
    if (NUMERIC_KINDS.includes(kind) && typeof raw === 'number') return raw;
    if (kind === 'boolean') return raw ? doc.labels.yes : doc.labels.no;
    if (kind === 'enum') return enumLabel(String(raw));
    return typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
}

/** Formato numérico de Excel por tipo de columna (con prefijo opcional, ej. "Prom. "). */
function numFmt(kind: ColumnKind, ctx: FormatContext, prefix = ''): string | undefined {
    const p = prefix ? `"${prefix}"` : '';
    switch (kind) {
        case 'money':
            return `${p}"${currencyPrefix(ctx)} "#,##0.00`;
        case 'count':
            return `${p}#,##0`;
        case 'number':
            return `${p}#,##0.00`;
        case 'percent':
            return `${p}0.0%`;
        case 'date':
            return 'dd/mm/yyyy';
        case 'datetime':
            return 'dd/mm/yyyy hh:mm';
        case 'month':
            return 'mm/yyyy';
        default:
            return prefix ? `${p}@` : undefined;
    }
}

/** Texto tal como se ve (PDF y medición de anchos en Excel). */
function displayText(column: Pick<ReportColumn, 'key' | 'kind'>, raw: unknown, doc: ReportDocument): string {
    const value = sheetValue(column, raw, doc);
    if (value === null) return doc.labels.empty;
    return formatCellValue(column.kind, value, doc.ctx);
}

function formatCellValue(kind: ColumnKind, value: string | number | Date, ctx: FormatContext): string {
    if (value instanceof Date) {
        const date = `${pad(value.getUTCDate())}/${pad(value.getUTCMonth() + 1)}/${value.getUTCFullYear()}`;
        if (kind === 'month') return `${pad(value.getUTCMonth() + 1)}/${value.getUTCFullYear()}`;
        if (kind === 'datetime') return `${date} ${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`;
        return date;
    }
    if (typeof value === 'number') {
        switch (kind) {
            case 'money':
                return `${currencyPrefix(ctx)} ${formatBo(value, 2)}`;
            case 'count':
                return formatBo(value, Number.isInteger(value) ? 0 : 2);
            case 'percent':
                return `${formatBo(value * 100, 1)}%`;
            default:
                return formatBo(value, 2);
        }
    }
    return value;
}

type HAlign = 'left' | 'center' | 'right';
/** Números a la derecha; fechas, enteros y porcentajes al centro; texto a la izquierda. */
function alignFor(kind: ColumnKind): HAlign {
    if (kind === 'money' || kind === 'number') return 'right';
    if (kind === 'count' || kind === 'percent' || kind === 'date' || kind === 'datetime' || kind === 'month') return 'center';
    return 'left';
}

// ───────────────────────────── Fila de totales ─────────────────────────────

type TotalOp = 'SUM' | 'AVERAGE' | 'COUNTA' | 'MAX' | 'MIN';
const OP_LABEL: Record<TotalOp, string> = { SUM: 'Total', AVERAGE: 'Promedio', COUNTA: 'Cantidad', MAX: 'Máximo', MIN: 'Mínimo' };
const OP_PREFIX: Record<TotalOp, string> = { SUM: 'Total ', AVERAGE: 'Prom. ', COUNTA: 'Cant. ', MAX: 'Máx. ', MIN: 'Mín. ' };

function totalOp(column: ReportColumn): TotalOp | null {
    const name = `${column.key} ${column.label}`.toLowerCase();
    if (NUMERIC_KINDS.includes(column.kind)) {
        if (/(max|máx)/.test(name)) return 'MAX';
        if (/(^|[\s_])(min|mín)/.test(name)) return 'MIN';
        if (column.kind === 'percent' || /(prom|avg|media|ticket|tasa|precio_unit)/.test(name)) return 'AVERAGE';
        return 'SUM';
    }
    if (column.kind === 'reference') return 'COUNTA';
    return null;
}

/** Operación por columna; `label` = texto de la 1ª celda ("Total", "Promedio"…) o null si allí va un valor. */
function planTotals(columns: ReportColumn[]): (null | { op: TotalOp; prefix: string })[] & { label?: string | null } {
    const ops = columns.map((c, i) => (i === 0 && !NUMERIC_KINDS.includes(c.kind) ? null : totalOp(c)));
    const used = [...new Set(ops.filter((o): o is TotalOp => !!o))];
    const labelSlot = ops[0] === null;
    // Una sola operación y hay dónde rotularla → "Promedio" en la 1ª celda; si no, se antepone a cada valor
    const prefixed = used.length > 1 || !labelSlot;
    const plan = ops.map((op) => (op ? { op, prefix: prefixed ? OP_PREFIX[op] : '' } : null)) as (null | { op: TotalOp; prefix: string })[] & {
        label?: string | null;
    };
    plan.label = labelSlot ? (used.length === 1 ? OP_LABEL[used[0]] : 'Totales') : null;
    return plan;
}

function aggregate(op: TotalOp, values: (string | number | Date | null)[]): number | null {
    if (op === 'COUNTA') return values.filter((v) => v !== null && v !== '').length;
    const nums = values.filter((v): v is number => typeof v === 'number');
    if (nums.length === 0) return op === 'SUM' ? 0 : null;
    if (op === 'SUM') return nums.reduce((a, b) => a + b, 0);
    if (op === 'AVERAGE') return nums.reduce((a, b) => a + b, 0) / nums.length;
    return op === 'MAX' ? Math.max(...nums) : Math.min(...nums);
}

// ───────────────────────────── Textos comunes ─────────────────────────────

function generatedText(doc: ReportDocument): string {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-CA', {
            timeZone: doc.ctx.timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
        })
            .formatToParts(doc.generatedAt)
            .map((p) => [p.type, p.value]),
    );
    return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

const infoText = (doc: ReportDocument) => `Tienda: ${doc.store}  |  Período: ${doc.period}  |  Generado: ${generatedText(doc)}  |  Por: ${doc.user}`;
const voiceText = (doc: ReportDocument) => `Consulta por voz: "${doc.voiceQuery}"`;

/** Fecha AAAA-MM-DD en la zona del reporte. */
function isoDay(date: Date, timeZone: string): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** titulo_en_snake_case_AAAA-MM-DD (sin extensión). */
export function reportFilename(title: string, date: Date, timeZone: string, fallback = 'reporte'): string {
    const slug = title
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/(^_+|_+$)/g, '')
        .slice(0, 60)
        .replace(/_+$/, '');
    return `${slug || fallback}_${isoDay(date, timeZone)}`;
}

/** Título legible a partir de la pregunta: primera letra en mayúscula, sin espacios de más. */
export const reportTitle = (prompt: string) => {
    const text = prompt.replace(/\s+/g, ' ').trim();
    return text.charAt(0).toUpperCase() + text.slice(1);
};

/** Nombre de hoja válido: máx. 31 caracteres, sin \ / ? * [ ] : */
export function sheetName(title: string): string {
    const clean = title.replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '');
    return clean.slice(0, 31).trim() || 'Reporte';
}

// ───────────────────────────── Excel ─────────────────────────────

const FONT = 'Arial';
const argb = (hex: string) => `FF${hex.replace('#', '').toUpperCase()}`;
const solid = (hex: string): Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } });
const font = (opts: Partial<Font> & { hex?: string } = {}): Partial<Font> => {
    const { hex, ...rest } = opts;
    return { name: FONT, size: 10, color: { argb: argb(hex ?? TEXT) }, ...rest };
};
const thinBox = (hex: string): Partial<Borders> => {
    const side = { style: 'thin' as const, color: { argb: argb(hex) } };
    return { top: side, left: side, bottom: side, right: side };
};

function colLetter(index: number): string {
    let n = index + 1;
    let s = '';
    while (n > 0) {
        const r = (n - 1) % 26;
        s = String.fromCharCode(65 + r) + s;
        n = Math.floor((n - 1) / 26);
    }
    return s;
}

/** Banda de ancho completo (celdas combinadas) con fondo y texto. */
function band(ws: Worksheet, row: number, span: number, text: string, fill: string, f: Partial<Font>, height: number, align: Partial<Alignment> = {}) {
    if (span > 1) ws.mergeCells(row, 1, row, span);
    for (let c = 1; c <= span; c++) {
        const cell = ws.getCell(row, c);
        cell.fill = solid(fill);
        cell.font = f;
    }
    const cell = ws.getCell(row, 1);
    cell.value = text;
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true, ...align };
    ws.getRow(row).height = height;
}

/** Ancho aproximado (en caracteres de Excel) que ocupa un texto con cierto tamaño de fuente. */
const textWidth = (text: string, size = 10, bold = false) => text.length * (size / 10) * (bold ? 1.12 : 1);

export async function createReportWorkbook(doc: ReportDocument): Promise<Workbook> {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = doc.user;
    wb.title = doc.title;
    wb.company = doc.store;
    wb.created = doc.generatedAt;
    wb.calcProperties.fullCalcOnLoad = true;

    const primary = doc.primaryColor;
    const maxTableCols = Math.max(0, ...doc.sections.map((s) => s.columns.length));
    const span = Math.max(1, maxTableCols, doc.kpis.length);
    const landscape = maxTableCols > 5;

    const ws = wb.addWorksheet(sheetName(doc.title), {
        properties: { tabColor: { argb: argb(primary) } },
        views: [{ showGridLines: false }],
        pageSetup: {
            paperSize: 9, // A4
            orientation: landscape ? 'landscape' : 'portrait',
            fitToPage: true,
            fitToWidth: 1,
            fitToHeight: 0,
            printTitlesRow: '1:2',
            horizontalCentered: true,
            margins: { left: 0.6, right: 0.6, top: 0.6, bottom: 0.75, header: 0.3, footer: 0.3 },
        },
        headerFooter: { oddFooter: `&C&"Arial,Regular"&9${doc.store.replace(/&/g, '&&')} — Página &P de &N` },
    });

    // Anchos: lo más largo que se verá en cada columna (encabezado, datos, totales, KPIs)
    const widths = new Array(span).fill(0);
    const fit = (i: number, w: number) => (widths[i] = Math.max(widths[i], w));

    // 1. Título
    let r = 1;
    band(ws, r, span, doc.title, primary, font({ size: 18, bold: true, hex: WHITE }), 34);
    // 2. Información
    r++;
    band(ws, r, span, infoText(doc), lighten(primary, 0.88), font({ size: 9, bold: true, italic: true, hex: darken(primary, 0.1) }), 20);
    // 3. Consulta por voz
    if (doc.voiceQuery) {
        r++;
        band(ws, r, span, voiceText(doc), WHITE, font({ size: 9, hex: MUTED }), 18);
    }
    r += 2;

    // 4. Tarjetas de resumen
    if (doc.kpis.length > 0) {
        doc.kpis.forEach((kpi, i) => {
            const t = tone(paletteColor(i, primary));
            const label = ws.getCell(r, i + 1);
            label.value = kpi.label;
            label.fill = solid(t.base);
            label.font = font({ bold: true, hex: WHITE });
            label.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            label.border = thinBox(t.border);
            const value = ws.getCell(r + 1, i + 1);
            const column = { key: `kpi${i}`, kind: kpi.kind };
            const v = sheetValue(column, kpi.value, doc);
            value.value = v;
            value.numFmt = numFmt(kpi.kind, doc.ctx) ?? 'General';
            value.fill = solid(lighten(t.base, 0.9));
            value.font = font({ size: 16, bold: true, hex: t.totalText });
            value.alignment = { horizontal: 'center', vertical: 'middle', wrapText: !NUMERIC_KINDS.includes(kpi.kind) };
            value.border = thinBox(t.border);
            fit(i, Math.min(45, textWidth(kpi.label, 10, true)));
            fit(i, textWidth(displayText(column, kpi.value, doc), 16, true));
        });
        ws.getRow(r).height = 22;
        ws.getRow(r + 1).height = 34;
        r += 2 + 2;
    }

    // 5. Una tabla por grupo
    let freezeAt = 2;
    doc.sections.forEach((section, si) => {
        const t = tone(paletteColor(si, primary));
        const cols = section.columns;
        const width = Math.max(1, cols.length);

        band(ws, r, width, section.title, t.base, font({ size: 12, bold: true, hex: WHITE }), 22);
        r++;

        if (section.rows.length === 0) {
            if (width > 1) ws.mergeCells(r, 1, r, width);
            const cell = ws.getCell(r, 1);
            cell.value = 'Sin datos para este grupo';
            cell.font = font({ italic: true, hex: MUTED });
            cell.alignment = { horizontal: 'left', indent: 1, vertical: 'middle' };
            r += 1 + 2;
            return;
        }

        // Encabezados
        const headerRow = r;
        cols.forEach((c, i) => {
            const cell = ws.getCell(r, i + 1);
            cell.value = c.label;
            cell.fill = solid(t.header);
            cell.font = font({ bold: true, hex: WHITE });
            cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            cell.border = thinBox(t.border);
            fit(i, Math.min(45, textWidth(c.label, 10, true)));
        });
        ws.getRow(r).height = 20;
        if (doc.sections.length === 1 && doc.kpis.length === 0) freezeAt = headerRow;
        r++;

        // Filas (cebra)
        const first = r;
        const columnValues: (string | number | Date | null)[][] = cols.map(() => []);
        section.rows.forEach((row, ri) => {
            const fill = solid(ri % 2 === 0 ? WHITE : t.zebra);
            cols.forEach((c, i) => {
                const cell = ws.getCell(r, i + 1);
                const v = sheetValue(c, row[c.key], doc);
                columnValues[i].push(v);
                cell.value = v;
                const fmt = numFmt(c.kind, doc.ctx);
                if (fmt) cell.numFmt = fmt;
                cell.fill = fill;
                cell.font = font();
                cell.border = thinBox(t.border);
                cell.alignment = { horizontal: alignFor(c.kind), vertical: 'middle', wrapText: alignFor(c.kind) === 'left' };
                fit(i, textWidth(displayText(c, row[c.key], doc)));
            });
            r++;
        });
        const last = r - 1;

        // Totales con fórmulas
        const plan = planTotals(cols);
        cols.forEach((c, i) => {
            const cell: Cell = ws.getCell(r, i + 1);
            const item = plan[i];
            cell.fill = solid(t.total);
            cell.font = font({ bold: true, hex: t.totalText });
            const side = { style: 'thin' as const, color: { argb: argb(t.border) } };
            cell.border = { top: { style: 'thick', color: { argb: argb(t.base) } }, left: side, right: side, bottom: side };
            cell.alignment = { horizontal: i === 0 && plan.label ? 'left' : alignFor(c.kind), vertical: 'middle' };
            if (i === 0 && plan.label) {
                cell.value = plan.label;
                fit(i, textWidth(plan.label, 10, true));
                return;
            }
            if (!item) return;
            const range = `${colLetter(i)}${first}:${colLetter(i)}${last}`;
            const result = aggregate(item.op, columnValues[i]);
            const formula = item.op === 'AVERAGE' ? `IFERROR(AVERAGE(${range}),"")` : `${item.op}(${range})`;
            cell.value = { formula, result: result ?? '' } as Cell['value'];
            const kind: ColumnKind = item.op === 'COUNTA' ? 'count' : c.kind;
            cell.numFmt = numFmt(kind, doc.ctx, item.prefix) ?? 'General';
            if (item.op === 'COUNTA') cell.alignment = { horizontal: 'center', vertical: 'middle' };
            if (result !== null) fit(i, textWidth(item.prefix + formatCellValue(kind, result, doc.ctx), 10, true));
        });
        ws.getRow(r).height = 20;
        r += 1 + 2; // 2 filas de separación entre tablas
    });

    // Anchos automáticos (mín. 14, máx. 45) y, si el título no cabe, se reparten más ancho
    const finalWidths = widths.map((w) => Math.min(45, Math.max(14, Math.ceil(w + 3))));
    const titleNeed = Math.max(textWidth(doc.title, 18, true), textWidth(infoText(doc), 9, true)) + 4;
    let total = finalWidths.reduce((a, b) => a + b, 0);
    // Reparto parejo, de a 1 carácter por columna, sin pasar de 45
    for (let i = 0; total < titleNeed && finalWidths.some((w) => w < 45); i = (i + 1) % span) {
        if (finalWidths[i] >= 45) continue;
        finalWidths[i]++;
        total++;
    }
    finalWidths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
    // Si aun así no cabe en una línea, las bandas crecen en alto (tienen ajuste de texto)
    const lines = (need: number) => Math.max(1, Math.ceil(need / Math.max(1, total)));
    ws.getRow(1).height = 34 * lines(textWidth(doc.title, 18, true) + 2);
    ws.getRow(2).height = 20 * lines(textWidth(infoText(doc), 9, true) + 2);

    ws.views = [{ state: 'frozen', xSplit: 0, ySplit: freezeAt, showGridLines: false }];
    return wb;
}

// ───────────────────────────── PDF ─────────────────────────────

const MARGIN = 15; // 1,5 cm
const FOOTER_SPACE = 14;

export async function createReportPdf(doc: ReportDocument): Promise<JsPdf> {
    const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
    const landscape = doc.sections.some((s) => s.columns.length > 5);
    const pdf = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
    pdf.setProperties({ title: doc.title, author: doc.store, subject: doc.period, creator: doc.store });

    const primary = doc.primaryColor;
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const W = pageW - MARGIN * 2;
    const bottom = pageH - MARGIN - FOOTER_SPACE + 6;
    const fill = (hex: string) => pdf.setFillColor(...hexToRgb(hex));
    const color = (hex: string) => pdf.setTextColor(...hexToRgb(hex));
    const setFont = (style: 'normal' | 'bold' | 'italic' | 'bolditalic', size: number) => {
        pdf.setFont('helvetica', style);
        pdf.setFontSize(size);
    };
    const lineH = (size: number) => (size * 0.3528) * 1.2; // pt → mm con interlineado

    /** Banda de ancho completo con texto ajustado. Devuelve la nueva y. */
    const drawBand = (y: number, width: number, text: string, bg: string | null, fg: string, style: 'normal' | 'bold' | 'italic' | 'bolditalic', size: number, minH: number) => {
        setFont(style, size);
        const lines = pdf.splitTextToSize(text, width - 6) as string[];
        const h = Math.max(minH, lines.length * lineH(size) + 4);
        if (bg) {
            fill(bg);
            pdf.rect(MARGIN, y, width, h, 'F');
        }
        color(fg);
        const textTop = y + h / 2 - ((lines.length - 1) * lineH(size)) / 2;
        pdf.text(lines, MARGIN + 3, textTop, { baseline: 'middle' });
        return y + h;
    };

    let y = MARGIN;
    // 1. Título · 2. Información · 3. Consulta por voz
    y = drawBand(y, W, doc.title, primary, WHITE, 'bold', 18, 13);
    y = drawBand(y, W, infoText(doc), lighten(primary, 0.88), darken(primary, 0.1), 'bolditalic', 9, 7);
    if (doc.voiceQuery) y = drawBand(y, W, voiceText(doc), null, MUTED, 'normal', 9, 6);
    y += 6;

    // 4. Tarjetas de resumen (hasta 6 por fila)
    if (doc.kpis.length > 0) {
        const perRow = Math.min(6, doc.kpis.length);
        const gap = 3;
        const cardW = (W - gap * (perRow - 1)) / perRow;
        for (let start = 0; start < doc.kpis.length; start += perRow) {
            doc.kpis.slice(start, start + perRow).forEach((kpi, j) => {
                const i = start + j;
                const t = tone(paletteColor(i, primary));
                const x = MARGIN + j * (cardW + gap);
                fill(t.base);
                pdf.rect(x, y, cardW, 7, 'F');
                setFont('bold', 9);
                color(WHITE);
                const label = (pdf.splitTextToSize(kpi.label, cardW - 4) as string[])[0];
                pdf.text(label, x + cardW / 2, y + 3.5, { align: 'center', baseline: 'middle' });
                fill(lighten(t.base, 0.9));
                pdf.rect(x, y + 7, cardW, 13, 'F');
                pdf.setDrawColor(...hexToRgb(t.border));
                pdf.setLineWidth(0.2);
                pdf.rect(x, y, cardW, 20, 'S');
                const text = displayText({ key: `kpi${i}`, kind: kpi.kind }, kpi.value, doc);
                let size = 16;
                setFont('bold', size);
                while (size > 8 && pdf.getTextWidth(text) > cardW - 4) setFont('bold', --size);
                color(t.totalText);
                pdf.text(text, x + cardW / 2, y + 13.5, { align: 'center', baseline: 'middle' });
            });
            y += 20 + 4;
        }
        y += 6;
    }

    // 5. Una tabla por grupo
    const ROW_H = 6.6; // alto aproximado de fila con letra 9
    for (const [si, section] of doc.sections.entries()) {
        const t = tone(paletteColor(si, primary));
        const cols = section.columns;
        const short = section.rows.length < 25;
        const needed = 9 + (short ? (section.rows.length + 2) * ROW_H : 4 * ROW_H);
        if (y + needed > bottom && y > MARGIN + 1) {
            pdf.addPage();
            y = MARGIN;
        }
        y = drawBand(y, W, section.title, t.base, WHITE, 'bold', 12, 9);

        if (section.rows.length === 0) {
            setFont('italic', 9);
            color(MUTED);
            pdf.text('Sin datos para este grupo', MARGIN + 3, y + 5, { baseline: 'middle' });
            y += 10 + 10;
            continue;
        }

        const columnValues = cols.map((c) => section.rows.map((row) => sheetValue(c, row[c.key], doc)));
        const plan = planTotals(cols);
        const foot = cols.map((c, i) => {
            if (i === 0 && plan.label) return { content: plan.label, styles: { halign: 'left' as HAlign } };
            const item = plan[i];
            if (!item) return '';
            const result = aggregate(item.op, columnValues[i]);
            const kind: ColumnKind = item.op === 'COUNTA' ? 'count' : c.kind;
            return { content: result === null ? '' : item.prefix + formatCellValue(kind, result, doc.ctx), styles: { halign: item.op === 'COUNTA' ? ('center' as HAlign) : alignFor(c.kind) } };
        });

        autoTable(pdf, {
            startY: y,
            margin: { left: MARGIN, right: MARGIN, top: MARGIN, bottom: MARGIN + FOOTER_SPACE - 6 },
            tableWidth: W,
            theme: 'grid',
            head: [cols.map((c) => c.label)],
            body: section.rows.map((row) => cols.map((c) => displayText(c, row[c.key], doc))),
            foot: [foot],
            showHead: 'everyPage',
            showFoot: 'lastPage',
            rowPageBreak: 'avoid',
            styles: { font: 'helvetica', fontSize: 9, textColor: hexToRgb(TEXT), lineColor: hexToRgb(t.border), lineWidth: 0.2, cellPadding: 1.8, valign: 'middle', overflow: 'linebreak' },
            headStyles: { fillColor: hexToRgb(t.header), textColor: 255, fontStyle: 'bold', halign: 'center' },
            bodyStyles: { fillColor: [255, 255, 255] },
            alternateRowStyles: { fillColor: hexToRgb(t.zebra) },
            footStyles: { fillColor: hexToRgb(t.total), textColor: hexToRgb(t.totalText), fontStyle: 'bold' },
            columnStyles: Object.fromEntries(cols.map((c, i) => [i, { halign: alignFor(c.kind) }])),
            didDrawCell: (data) => {
                // Línea superior gruesa del color de la tabla sobre la fila de totales
                if (data.section !== 'foot') return;
                pdf.setDrawColor(...hexToRgb(t.base));
                pdf.setLineWidth(0.7);
                pdf.line(data.cell.x, data.cell.y, data.cell.x + data.cell.width, data.cell.y);
            },
        });
        y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10; // ~2 filas de separación
    }

    // Pie de página en cada hoja
    const pages = pdf.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
        pdf.setPage(p);
        const lineY = pageH - MARGIN + 2;
        pdf.setDrawColor(...hexToRgb(primary));
        pdf.setLineWidth(0.3);
        pdf.line(MARGIN, lineY, pageW - MARGIN, lineY);
        setFont('normal', 8);
        color(MUTED);
        const right = `Página ${p}`;
        const leftMax = W - pdf.getTextWidth(right) - 6;
        const left = (pdf.splitTextToSize(`${doc.store} · ${doc.title}`, leftMax) as string[])[0];
        pdf.text(left, MARGIN, lineY + 4.5);
        pdf.text(right, pageW - MARGIN, lineY + 4.5, { align: 'right' });
    }
    return pdf;
}

// ───────────────────────────── Descarga (navegador) ─────────────────────────────

function download(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportReportExcel(doc: ReportDocument, filename: string) {
    const wb = await createReportWorkbook(doc);
    const buffer = await wb.xlsx.writeBuffer();
    download(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${filename}.xlsx`);
}

export async function exportReportPdf(doc: ReportDocument, filename: string) {
    const pdf = await createReportPdf(doc);
    pdf.save(`${filename}.pdf`);
}
