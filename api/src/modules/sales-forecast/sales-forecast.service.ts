import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { hasAllBranches } from '../../common/utils/permission.util';
import { i18nMessage } from '../../i18n/i18n-message';
import { requireTenant, runInTenant, tenantSchemaSql, type TenantContext } from '../../tenancy/tenant-context';
import type { AuthUser } from '../../common/decorators/interfaces/request-with-user.interface';
import { resolveReportBranchId } from '../reports/report-scope';
import { forecastPython, forecastRoot, tenantForecastDir, type ForecastSource } from './forecast-paths';

export type ForecastStatus = 'sin_entrenar' | 'entrenando' | 'listo' | 'datos_insuficientes' | 'error';
export type ForecastErrorCode = 'python_no_disponible' | 'interrumpido' | 'entrada_invalida' | 'fallo_entrenamiento';

interface StatusFile {
  estado: Exclude<ForecastStatus, 'sin_entrenar'>;
  iniciadoEn: string;
  finalizadoEn?: string;
  codigoError?: ForecastErrorCode;
}

// Códigos de salida de `python -m pronostico_ventas` (IA/AS/pronostico_ventas/cli.py)
const EXIT_OK = 0;
const EXIT_INSUFFICIENT = 3;
const EXIT_BAD_INPUT = 2;
const TRAIN_TIMEOUT_MS = 15 * 60 * 1000;

@Injectable()
export class SalesForecastService {
  private readonly logger = new Logger(SalesForecastService.name);
  private readonly root: string;
  private readonly python: string;
  // Una ejecución por tienda a la vez (real o demo). Es un único proceso de API local.
  private readonly running = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.root = forecastRoot(config.get<string>('FORECAST_DIR'));
    this.python = forecastPython(this.root, config.get<string>('FORECAST_PYTHON'));
  }

  // -------------------------------------------------------------------------------------------
  // Lectura (no entrena nunca)
  // -------------------------------------------------------------------------------------------

  async getForecast(actor: AuthUser, source: ForecastSource, requestedBranchId?: string) {
    const branchId = resolveReportBranchId(actor, requestedBranchId);
    const { tenantId } = requireTenant();
    const dir = tenantForecastDir(this.root, tenantId, source);

    const status = await this.readStatus(dir, tenantId);
    const result = await this.readResult(dir, tenantId);

    let rows: Record<string, unknown>[] = Array.isArray(result?.pronostico) ? (result.pronostico as Record<string, unknown>[]) : [];
    if (branchId) {
      // Sin alcance global: solo su sucursal (+ los productos sin historial, que no tienen sucursal)
      rows = rows.filter((row) => row.sucursal_id === branchId || row.sucursal_id === null);
    }

    return {
      source,
      simulated: source === 'demo',
      status: status.estado,
      startedAt: status.iniciadoEn ?? null,
      finishedAt: status.finalizadoEn ?? null,
      errorCode: status.codigoError ?? null,
      canTrain: hasAllBranches(actor),
      branchId: branchId ?? null,
      result: result ? { ...result, pronostico: undefined } : null,
      forecast: rows,
    };
  }

  // -------------------------------------------------------------------------------------------
  // Entrenamiento (acción explícita, una a la vez por tienda)
  // -------------------------------------------------------------------------------------------

  async startTraining(actor: AuthUser, source: ForecastSource) {
    // El modelo es de toda la tienda: entrenarlo requiere alcance global
    if (!hasAllBranches(actor)) throw new ForbiddenException(i18nMessage('errors.FORECAST_STORE_WIDE_REQUIRED'));
    const ctx = requireTenant();
    const dir = tenantForecastDir(this.root, ctx.tenantId, source);
    if (this.running.has(ctx.tenantId)) throw new ConflictException(i18nMessage('errors.FORECAST_ALREADY_RUNNING'));
    const pythonMissing = isAbsolute(this.python) && !existsSync(this.python);
    if (pythonMissing || !existsSync(join(this.root, 'pronostico_ventas'))) {
      throw new ServiceUnavailableException(i18nMessage('errors.FORECAST_UNAVAILABLE'));
    }

    this.running.add(ctx.tenantId);
    const startedAt = new Date().toISOString();
    try {
      await mkdir(dir, { recursive: true });
      await this.writeStatus(dir, { estado: 'entrenando', iniciadoEn: startedAt });
    } catch (error) {
      this.running.delete(ctx.tenantId);
      throw error;
    }

    // En segundo plano, con el contexto de la tienda explícito (la extracción usa su schema)
    void runInTenant(ctx, () => this.runJob(ctx, dir, source, startedAt)).finally(() => this.running.delete(ctx.tenantId));
    return { source, status: 'entrenando' as const, startedAt };
  }

  /** Borra solo la demo SIMULADA de esta tienda (salidas/web/demo/<tenantId>). */
  async deleteDemo(actor: AuthUser) {
    if (!hasAllBranches(actor)) throw new ForbiddenException(i18nMessage('errors.FORECAST_STORE_WIDE_REQUIRED'));
    const { tenantId } = requireTenant();
    if (this.running.has(tenantId)) throw new ConflictException(i18nMessage('errors.FORECAST_ALREADY_RUNNING'));
    await rm(tenantForecastDir(this.root, tenantId, 'demo'), { recursive: true, force: true });
    return { source: 'demo' as const, status: 'sin_entrenar' as const };
  }

  private async runJob(ctx: TenantContext, dir: string, source: ForecastSource, startedAt: string): Promise<void> {
    const input = join(dir, 'entrada');
    const output = join(dir, 'resultado');
    let status: StatusFile;
    try {
      await rm(input, { recursive: true, force: true });
      if (source === 'real') {
        await this.exportRealData(ctx, input);
      } else {
        const sim = await this.runPython(['simular', '--salida', input, '--tienda-id', ctx.tenantId, '--tienda-nombre', 'Demo simulada']);
        if (sim !== EXIT_OK) throw new Error(`simular terminó con código ${sim}`);
      }
      const code = await this.runPython(['entrenar', '--entrada', input, '--salida', output]);
      status =
        code === EXIT_OK
          ? { estado: 'listo', iniciadoEn: startedAt }
          : code === EXIT_INSUFFICIENT
            ? { estado: 'datos_insuficientes', iniciadoEn: startedAt }
            : { estado: 'error', iniciadoEn: startedAt, codigoError: code === EXIT_BAD_INPUT ? 'entrada_invalida' : 'fallo_entrenamiento' };
    } catch (error) {
      const notFound = (error as NodeJS.ErrnoException)?.code === 'ENOENT';
      this.logger.error(`Pronóstico (${source}) de la tienda ${ctx.tenantId} falló: ${(error as Error).message}`);
      status = { estado: 'error', iniciadoEn: startedAt, codigoError: notFound ? 'python_no_disponible' : 'fallo_entrenamiento' };
    }
    await this.writeStatus(dir, { ...status, finalizadoEn: new Date().toISOString() }).catch((error: Error) =>
      this.logger.error(`No se pudo guardar el estado del pronóstico: ${error.message}`),
    );
  }

  /** Proceso Python local, sin shell y sin heredar secretos del entorno de la API. */
  private runPython(args: string[]): Promise<number> {
    const env: NodeJS.ProcessEnv = { PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' };
    for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'NUMBER_OF_PROCESSORS', 'LOCALAPPDATA', 'USERPROFILE', 'HOME']) {
      if (process.env[key]) env[key] = process.env[key];
    }
    return new Promise((resolvePromise, reject) => {
      const child = spawn(this.python, ['-m', 'pronostico_ventas', ...args], {
        cwd: this.root,
        env,
        shell: false,
        windowsHide: true,
        timeout: TRAIN_TIMEOUT_MS,
      });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString('utf8')).slice(-2000);
      });
      child.stdout.resume();
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== EXIT_OK && code !== EXIT_INSUFFICIENT) this.logger.warn(`pronostico_ventas ${args[0]} -> ${code}: ${stderr.trim()}`);
        resolvePromise(code ?? 1);
      });
    });
  }

  // -------------------------------------------------------------------------------------------
  // Extracción de datos reales: solo lectura, solo el schema de la tienda del contexto, sin datos personales
  // -------------------------------------------------------------------------------------------

  private async exportRealData(ctx: TenantContext, input: string): Promise<void> {
    const cutoff = new Date();
    const schema = tenantSchemaSql();
    const [sales, returns, products, branches] = await Promise.all([
      this.prisma.$queryRaw<{ fecha: Date; estado: string; sucursal_id: string | null; producto_id: string; talla: string | null; unidades: number }[]>(Prisma.sql`
        SELECT o."createdAt" AS fecha, o."status"::text AS estado, o."branchId" AS sucursal_id,
               oi."productId" AS producto_id, oi."size" AS talla, oi."quantity"::int AS unidades
        FROM ${schema}.order_items oi
        JOIN ${schema}.orders o ON o."id" = oi."orderId"
        WHERE o."createdAt" < ${cutoff} AND oi."quantity" > 0
        ORDER BY o."createdAt"`),
      // La devolución se atribuye a la sucursal que vendió (orders.branchId), en la fecha en que se registró
      this.prisma.$queryRaw<{ fecha: Date; sucursal_id: string | null; producto_id: string; talla: string | null; unidades: number }[]>(Prisma.sql`
        SELECT r."createdAt" AS fecha, o."branchId" AS sucursal_id, ri."productId" AS producto_id,
               ri."size" AS talla, ri."quantity"::int AS unidades
        FROM ${schema}.return_items ri
        JOIN ${schema}.returns r ON r."id" = ri."returnId"
        JOIN ${schema}.orders o ON o."id" = r."orderId"
        WHERE r."createdAt" < ${cutoff}`),
      this.prisma.$queryRaw<{ producto_id: string; nombre: string; categoria: string | null; creado_en: Date; activo: boolean }[]>(Prisma.sql`
        SELECT p."id" AS producto_id, p."name" AS nombre, c."name" AS categoria, p."createdAt" AS creado_en, p."isActive" AS activo
        FROM ${schema}.products p LEFT JOIN ${schema}.categories c ON c."id" = p."categoryId"`),
      this.prisma.$queryRaw<{ sucursal_id: string; nombre: string; creada_en: Date; activa: boolean }[]>(Prisma.sql`
        SELECT b."id" AS sucursal_id, b."name" AS nombre, b."createdAt" AS creada_en, b."isActive" AS activa
        FROM ${schema}.branches b`),
    ]);

    await mkdir(input, { recursive: true });
    const t = ctx.tenantId;
    await writeFile(join(input, 'ventas.csv'), toCsv(
      ['tienda_id', 'pedido_id', 'fecha', 'estado', 'sucursal_id', 'producto_id', 'talla', 'unidades'],
      // pedido_id es un correlativo: el id real del pedido no hace falta para el modelo
      sales.map((r, i) => [t, `l${i + 1}`, r.fecha.toISOString(), r.estado, r.sucursal_id ?? '', r.producto_id, r.talla ?? '', r.unidades]),
    ));
    await writeFile(join(input, 'devoluciones.csv'), toCsv(
      ['tienda_id', 'fecha', 'sucursal_id', 'producto_id', 'talla', 'unidades'],
      returns.map((r) => [t, r.fecha.toISOString(), r.sucursal_id ?? '', r.producto_id, r.talla ?? '', r.unidades]),
    ));
    await writeFile(join(input, 'productos.csv'), toCsv(
      ['tienda_id', 'producto_id', 'nombre', 'categoria', 'creado_en', 'activo'],
      products.map((r) => [t, r.producto_id, r.nombre, r.categoria ?? '', r.creado_en.toISOString(), r.activo]),
    ));
    await writeFile(join(input, 'sucursales.csv'), toCsv(
      ['tienda_id', 'sucursal_id', 'nombre', 'creada_en', 'activa'],
      branches.map((r) => [t, r.sucursal_id, r.nombre, r.creada_en.toISOString(), r.activa]),
    ));
    await writeFile(join(input, 'origen.json'), JSON.stringify({
      origen: 'real', tienda_id: t, tienda_nombre: t, corte: cutoff.toISOString(), semilla: null,
      aviso: 'Extracción de solo lectura de la tienda autenticada',
    }, null, 2));
  }

  // -------------------------------------------------------------------------------------------
  // Archivos de estado
  // -------------------------------------------------------------------------------------------

  private async readStatus(dir: string, tenantId: string): Promise<StatusFile | { estado: 'sin_entrenar'; iniciadoEn?: undefined; finalizadoEn?: undefined; codigoError?: undefined }> {
    const file = await readJson<StatusFile>(join(dir, 'estado.json'));
    if (!file) return { estado: 'sin_entrenar' };
    // "entrenando" sin proceso vivo = la API se reinició a mitad del entrenamiento
    if (file.estado === 'entrenando' && !this.running.has(tenantId)) {
      return { ...file, estado: 'error', codigoError: 'interrumpido' };
    }
    return file;
  }

  private async readResult(dir: string, tenantId: string): Promise<Record<string, unknown> | null> {
    const result = await readJson<Record<string, unknown>>(join(dir, 'resultado', 'resultado.json'));
    if (!result) return null;
    // Defensa extra: un resultado de otra tienda nunca se devuelve
    if (result.tienda_id !== tenantId) {
      this.logger.error(`resultado.json de ${dir} no pertenece a la tienda ${tenantId}: se ignora`);
      return null;
    }
    return result;
  }

  private async writeStatus(dir: string, status: StatusFile): Promise<void> {
    const tmp = join(dir, 'estado.json.tmp');
    await writeFile(tmp, JSON.stringify(status, null, 2));
    await rename(tmp, join(dir, 'estado.json'));
  }
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch (error) {
    // Archivo ausente o JSON a medias/corrupto: se trata como "sin resultado"
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
}
