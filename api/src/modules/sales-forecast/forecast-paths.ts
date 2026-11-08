import { isAbsolute, join, relative, resolve } from 'node:path';

// Rutas del pronóstico de ventas (IA/AS). Todas se derivan del tenant del request, nunca de algo que
// mande el navegador: una tienda no puede leer ni borrar carpetas de otra cambiando identificadores.

export const FORECAST_SOURCES = ['real', 'demo'] as const;
export type ForecastSource = (typeof FORECAST_SOURCES)[number];

const TENANT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Carpeta IA/AS: FORECAST_DIR o, por defecto, ../IA/AS relativo a api/ (donde corre `npm run dev`). */
export function forecastRoot(configured?: string): string {
  return resolve(configured?.trim() || join(process.cwd(), '..', 'IA', 'AS'));
}

/** Python del entorno virtual de IA/AS (FORECAST_PYTHON lo reemplaza). */
export function forecastPython(root: string, configured?: string): string {
  if (configured?.trim()) return configured.trim();
  return process.platform === 'win32' ? join(root, '.venv', 'Scripts', 'python.exe') : join(root, '.venv', 'bin', 'python');
}

/** <root>/salidas/web/<real|demo>/<tenantId>. Lanza si el id o el origen no son válidos. */
export function tenantForecastDir(root: string, tenantId: string, source: ForecastSource): string {
  if (!TENANT_ID_RE.test(tenantId)) throw new Error('Identificador de tienda inválido para el pronóstico');
  if (!(FORECAST_SOURCES as readonly string[]).includes(source)) throw new Error('Origen de pronóstico inválido');
  const dir = resolve(root, 'salidas', 'web', source, tenantId);
  const rel = relative(resolve(root, 'salidas', 'web'), dir);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Ruta de pronóstico fuera de su carpeta');
  return dir;
}
