// Calendario de la tienda para los reportes con IA: qué es "hoy", "ayer", "este mes" o "mes pasado"
// en la hora LOCAL de la tienda, no en UTC.
//
// Zona horaria: ninguna tienda la tiene configurada (no existe el campo en el plano de control ni en el
// schema de la tienda). Se usa REPORTS_TIMEZONE y, si no está, America/La_Paz (Bolivia, UTC-4 sin horario
// de verano), que es donde operan las tiendas actuales. Un campo por tienda requeriría una migración del
// plano de control (tenants.timezone): queda como evolución.

export const DEFAULT_REPORT_TIMEZONE = 'America/La_Paz';

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(zone);
  } catch {
    return false;
  }
}

/** Zona de la tienda actual. Se lee en cada petición (las pruebas la cambian). */
export function reportTimezone(): string {
  const configured = process.env.REPORTS_TIMEZONE?.trim();
  return configured && isValidTimeZone(configured) ? configured : DEFAULT_REPORT_TIMEZONE;
}

/** Moneda del catálogo: en ella están TODOS los importes (Stripe cobra totalAmount en PAYMENT_CURRENCY). */
export function reportCurrency(): string {
  const configured = (process.env.PAYMENT_CURRENCY?.trim() || 'bob').toUpperCase();
  return /^[A-Z]{3,5}$/.test(configured) ? configured : 'BOB';
}

export interface DateRange {
  /** Primer día incluido (YYYY-MM-DD, hora local) */
  desde: string;
  /** Primer día EXCLUIDO (YYYY-MM-DD): created_at >= desde AND created_at < hasta */
  hasta: string;
}

export interface ReportCalendar {
  timezone: string;
  /** Fecha y hora local actual, "YYYY-MM-DD HH:mm" */
  ahora: string;
  hoy: DateRange;
  ayer: DateRange;
  estaSemana: DateRange;
  semanaPasada: DateRange;
  esteMes: DateRange;
  mesPasado: DateRange;
  esteAnio: DateRange;
  anioPasado: DateRange;
}

interface Ymd {
  y: number;
  m: number; // 1-12
  d: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = ({ y, m, d }: Ymd) => `${String(y).padStart(4, '0')}-${pad(m)}-${pad(d)}`;

// Aritmética de calendario sobre fechas civiles (sin horas): Date.UTC solo como contador de días
const addDays = ({ y, m, d }: Ymd, days: number): Ymd => {
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};
const firstOfMonth = (y: number, m: number): Ymd => {
  const t = new Date(Date.UTC(y, m - 1, 1));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: 1 };
};

/** Partes de la fecha/hora local de `instant` en `timezone`. */
export function localParts(instant: Date, timezone: string): Ymd & { hh: number; mi: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), hh: Number(parts.hour), mi: Number(parts.minute) };
}

export function buildReportCalendar(now: Date, timezone: string): ReportCalendar {
  const local = localParts(now, timezone);
  const today: Ymd = { y: local.y, m: local.m, d: local.d };
  // Semana de lunes a domingo
  const weekday = new Date(Date.UTC(today.y, today.m - 1, today.d)).getUTCDay(); // 0 = domingo
  const monday = addDays(today, -((weekday + 6) % 7));
  const range = (from: Ymd, to: Ymd): DateRange => ({ desde: fmt(from), hasta: fmt(to) });

  return {
    timezone,
    ahora: `${fmt(today)} ${pad(local.hh)}:${pad(local.mi)}`,
    hoy: range(today, addDays(today, 1)),
    ayer: range(addDays(today, -1), today),
    estaSemana: range(monday, addDays(monday, 7)),
    semanaPasada: range(addDays(monday, -7), monday),
    esteMes: range(firstOfMonth(today.y, today.m), firstOfMonth(today.y, today.m + 1)),
    mesPasado: range(firstOfMonth(today.y, today.m - 1), firstOfMonth(today.y, today.m)),
    esteAnio: range({ y: today.y, m: 1, d: 1 }, { y: today.y + 1, m: 1, d: 1 }),
    anioPasado: range({ y: today.y - 1, m: 1, d: 1 }, { y: today.y, m: 1, d: 1 }),
  };
}
