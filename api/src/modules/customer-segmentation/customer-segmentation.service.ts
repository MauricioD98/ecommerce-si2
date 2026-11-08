import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
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
import { paymentCurrency } from '../../common/checkout/checkout-policy';
import { DEFAULT_ROLE } from '../../common/constants/permissions';
import { i18nMessage } from '../../i18n/i18n-message';
import { requireTenant, runInTenant, tenantSchemaSql, type TenantContext } from '../../tenancy/tenant-context';
import type { AuthUser } from '../../common/decorators/interfaces/request-with-user.interface';
import { WALK_IN_CUSTOMER_EMAIL } from '../pos/pos.service';
import { toCsv } from '../sales-forecast/sales-forecast.service';
import { segmentationPython, segmentationRoot, tenantSegmentationDir, type SegmentationSource } from './segmentation-paths';

export type SegmentationStatus = 'sin_entrenar' | 'entrenando' | 'listo' | 'datos_insuficientes' | 'error';
export type SegmentationErrorCode = 'python_no_disponible' | 'interrumpido' | 'entrada_invalida' | 'fallo_entrenamiento';

interface StatusFile {
  estado: Exclude<SegmentationStatus, 'sin_entrenar'>;
  iniciadoEn: string;
  finalizadoEn?: string;
  codigoError?: SegmentationErrorCode;
}

// Códigos de salida de `python -m segmentacion_clientes` (IA/ANS/segmentacion_clientes/cli.py)
const EXIT_OK = 0;
const EXIT_INSUFFICIENT = 3;
const EXIT_BAD_INPUT = 2;
const TRAIN_TIMEOUT_MS = 10 * 60 * 1000;

@Injectable()
export class CustomerSegmentationService {
  private readonly logger = new Logger(CustomerSegmentationService.name);
  private readonly root: string;
  private readonly python: string;
  // Una ejecución por tienda a la vez (real o demo). Es un único proceso de API local.
  private readonly running = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.root = segmentationRoot(config.get<string>('SEGMENTATION_DIR'));
    this.python = segmentationPython(this.root, config.get<string>('SEGMENTATION_PYTHON'));
  }

  /** Los grupos resumen clientes de TODAS las sucursales: solo quien tiene alcance global los ve o entrena. */
  private assertStoreWide(actor: AuthUser) {
    if (!hasAllBranches(actor)) throw new ForbiddenException(i18nMessage('errors.SEGMENTATION_STORE_WIDE_REQUIRED'));
  }

  // -------------------------------------------------------------------------------------------
  // Lectura (no entrena nunca)
  // -------------------------------------------------------------------------------------------

  async getSegments(actor: AuthUser, source: SegmentationSource) {
    this.assertStoreWide(actor);
    const { tenantId } = requireTenant();
    const dir = tenantSegmentationDir(this.root, tenantId, source);
    const status = await this.readStatus(dir, tenantId);
    const result = await this.readResult(dir, tenantId);
    return {
      source,
      simulated: source === 'demo',
      status: status.estado,
      startedAt: status.iniciadoEn ?? null,
      finishedAt: status.finalizadoEn ?? null,
      errorCode: status.codigoError ?? null,
      canTrain: true,
      // Solo resultados agregados: resultado.json no contiene clientes individuales (asignaciones.csv no se expone)
      result,
    };
  }

  // -------------------------------------------------------------------------------------------
  // Entrenamiento (acción explícita, una a la vez por tienda)
  // -------------------------------------------------------------------------------------------

  async startTraining(actor: AuthUser, source: SegmentationSource) {
    this.assertStoreWide(actor);
    const ctx = requireTenant();
    const dir = tenantSegmentationDir(this.root, ctx.tenantId, source);
    if (this.running.has(ctx.tenantId)) throw new ConflictException(i18nMessage('errors.SEGMENTATION_ALREADY_RUNNING'));
    const pythonMissing = isAbsolute(this.python) && !existsSync(this.python);
    if (pythonMissing || !existsSync(join(this.root, 'segmentacion_clientes'))) {
      throw new ServiceUnavailableException(i18nMessage('errors.SEGMENTATION_UNAVAILABLE'));
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
    this.assertStoreWide(actor);
    const { tenantId } = requireTenant();
    if (this.running.has(tenantId)) throw new ConflictException(i18nMessage('errors.SEGMENTATION_ALREADY_RUNNING'));
    await rm(tenantSegmentationDir(this.root, tenantId, 'demo'), { recursive: true, force: true });
    return { source: 'demo' as const, status: 'sin_entrenar' as const };
  }

  private async runJob(ctx: TenantContext, dir: string, source: SegmentationSource, startedAt: string): Promise<void> {
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
      this.logger.error(`Segmentación (${source}) de la tienda ${ctx.tenantId} falló: ${(error as Error).message}`);
      status = { estado: 'error', iniciadoEn: startedAt, codigoError: notFound ? 'python_no_disponible' : 'fallo_entrenamiento' };
    }
    await this.writeStatus(dir, { ...status, finalizadoEn: new Date().toISOString() }).catch((error: Error) =>
      this.logger.error(`No se pudo guardar el estado de la segmentación: ${error.message}`),
    );
  }

  /** Proceso Python local, sin shell y sin heredar secretos del entorno de la API. */
  private runPython(args: string[]): Promise<number> {
    const env: NodeJS.ProcessEnv = { PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' };
    for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'NUMBER_OF_PROCESSORS', 'LOCALAPPDATA', 'USERPROFILE', 'HOME']) {
      if (process.env[key]) env[key] = process.env[key];
    }
    return new Promise((resolvePromise, reject) => {
      const child = spawn(this.python, ['-m', 'segmentacion_clientes', ...args], {
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
      // stdout no se registra: los conteos ya quedan en resultado.json y así no van datos a los logs
      child.stdout.resume();
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== EXIT_OK && code !== EXIT_INSUFFICIENT) this.logger.warn(`segmentacion_clientes ${args[0]} -> ${code}: ${stderr.trim()}`);
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
    // Identificadores seudónimos y estables por tienda: los archivos no llevan ids reales, nombres ni correos
    const alias = (kind: string, id: string) => createHash('sha256').update(`${ctx.tenantId}:${kind}:${id}`).digest('hex').slice(0, 20);

    const [customers, orders, returns, walkIn] = await Promise.all([
      // Clientes de la tienda (rol Cliente) y cualquier usuario que haya comprado, salvo el "consumidor final" del POS
      this.prisma.$queryRaw<{ id: string; registrado_en: Date }[]>(Prisma.sql`
        SELECT u."id", u."createdAt" AS registrado_en
        FROM ${schema}.users u JOIN ${schema}.roles r ON r."id" = u."roleId"
        WHERE u."email" <> ${WALK_IN_CUSTOMER_EMAIL}
          AND (r."name" = ${DEFAULT_ROLE} OR EXISTS (SELECT 1 FROM ${schema}.orders o WHERE o."userId" = u."id"))`),
      this.prisma.$queryRaw<{ id: string; user_id: string; fecha: Date; estado: string; monto: string }[]>(Prisma.sql`
        SELECT o."id", o."userId" AS user_id, o."createdAt" AS fecha, o."status"::text AS estado, o."totalAmount"::text AS monto
        FROM ${schema}.orders o JOIN ${schema}.users u ON u."id" = o."userId"
        WHERE u."email" <> ${WALK_IN_CUSTOMER_EMAIL} AND o."createdAt" < ${cutoff}
        ORDER BY o."createdAt"`),
      this.prisma.$queryRaw<{ order_id: string; fecha: Date; monto: string }[]>(Prisma.sql`
        SELECT r."orderId" AS order_id, r."createdAt" AS fecha, r."totalRefunded"::text AS monto
        FROM ${schema}.returns r WHERE r."createdAt" < ${cutoff}`),
      this.prisma.$queryRaw<{ n: number }[]>(Prisma.sql`
        SELECT COUNT(*)::int AS n FROM ${schema}.orders o JOIN ${schema}.users u ON u."id" = o."userId"
        WHERE u."email" = ${WALK_IN_CUSTOMER_EMAIL} AND o."createdAt" < ${cutoff}`),
    ]);

    // Los pedidos no guardan moneda: todos están en la moneda de cobro de la tienda (PAYMENT_CURRENCY)
    const currency = paymentCurrency().toUpperCase();
    const exported = new Set(orders.map((o) => o.id));
    const t = ctx.tenantId;
    await mkdir(input, { recursive: true });
    await writeFile(join(input, 'clientes.csv'), toCsv(
      ['tienda_id', 'cliente_id', 'registrado_en'],
      customers.map((c) => [t, alias('cliente', c.id), c.registrado_en.toISOString()]),
    ));
    await writeFile(join(input, 'pedidos.csv'), toCsv(
      ['tienda_id', 'pedido_id', 'cliente_id', 'fecha', 'estado', 'monto', 'moneda'],
      orders.map((o) => [t, alias('pedido', o.id), alias('cliente', o.user_id), o.fecha.toISOString(), o.estado, o.monto, currency]),
    ));
    await writeFile(join(input, 'devoluciones.csv'), toCsv(
      ['tienda_id', 'pedido_id', 'fecha', 'monto'],
      returns.filter((r) => exported.has(r.order_id)).map((r) => [t, alias('pedido', r.order_id), r.fecha.toISOString(), r.monto]),
    ));
    await writeFile(join(input, 'origen.json'), JSON.stringify({
      origen: 'real', tienda_id: t, tienda_nombre: t, corte: cutoff.toISOString(), moneda: currency, semilla: null,
      pedidos_consumidor_final_excluidos: walkIn[0]?.n ?? 0,
      aviso: 'Extracción de solo lectura de la tienda autenticada (identificadores seudónimos, sin datos personales)',
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
