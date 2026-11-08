import { isAbsolute, join, relative, resolve } from 'node:path';

// Rutas de la segmentación de clientes (IA/ANS). Todas se derivan del tenant del request, nunca de algo que
// mande el navegador: una tienda no puede leer ni borrar carpetas de otra cambiando identificadores.

export const SEGMENTATION_SOURCES = ['real', 'demo'] as const;
export type SegmentationSource = (typeof SEGMENTATION_SOURCES)[number];

const TENANT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Carpeta IA/ANS: SEGMENTATION_DIR o, por defecto, ../IA/ANS relativo a api/ (donde corre `npm run dev`). */
export function segmentationRoot(configured?: string): string {
  return resolve(configured?.trim() || join(process.cwd(), '..', 'IA', 'ANS'));
}

/** Python del entorno virtual de IA/ANS (SEGMENTATION_PYTHON lo reemplaza). */
export function segmentationPython(root: string, configured?: string): string {
  if (configured?.trim()) return configured.trim();
  return process.platform === 'win32' ? join(root, '.venv', 'Scripts', 'python.exe') : join(root, '.venv', 'bin', 'python');
}

/** <root>/salidas/web/<real|demo>/<tenantId>. Lanza si el id o el origen no son válidos. */
export function tenantSegmentationDir(root: string, tenantId: string, source: SegmentationSource): string {
  if (!TENANT_ID_RE.test(tenantId)) throw new Error('Identificador de tienda inválido para la segmentación');
  if (!(SEGMENTATION_SOURCES as readonly string[]).includes(source)) throw new Error('Origen de segmentación inválido');
  const base = resolve(root, 'salidas', 'web');
  const dir = resolve(base, source, tenantId);
  const rel = relative(base, dir);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Ruta de segmentación fuera de su carpeta');
  return dir;
}
