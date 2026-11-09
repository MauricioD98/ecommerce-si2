import {
  BadGatewayException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { TenantSecretsService } from '../../tenancy/tenant-secrets.service';
import { PrismaService } from '../../prisma/prisma.service';
import { requireTenant } from '../../tenancy/tenant-context';
import { i18nMessage } from '../../i18n/i18n-message';
import {
  GarmentTooSmallError,
  GarmentUnavailableError,
  LIVE_MODEL,
  LiveSessionRegistry,
  MAX_CLOCK_SKEW_SECONDS,
  buildLivePrompt,
  deviceAheadOfProviderSeconds,
  deviceClockAheadSeconds,
  liveLimits,
  loadGarmentImage,
} from './try-on-live';

// Movido desde front/app/api/decart/session/route.ts: la API key de Decart es POR TIENDA y vive cifrada
// en public.tenant_integrations; si la tienda no tiene, se usa DECART_API_KEY del entorno. Solo el
// backend tiene acceso a cualquiera de las dos. Al navegador se
// le sigue entregando un token efímero (ek_...) acotado a un modelo, al origen y a una duración.
// Decart cobra por segundo generado, así que el token trae su propio techo: si el cliente ignora el
// setTimeout de 15s, Decart corta igual a los MAX_SESSION_SECONDS.

const MODEL = 'lucy-vton-latest';
// 15s de transmisión que muestra la UI + margen para el handshake de WebRTC. El mínimo que acepta
// Decart es 10s.
const MAX_SESSION_SECONDS = 25;
// TTL del token: solo necesita vivir lo que tarda el navegador en conectar. Expirar no corta una
// sesión ya activa, únicamente impide abrir nuevas.
const TOKEN_TTL_SECONDS = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Códigos estables para que la app móvil explique cada caso en su idioma
export const TRY_ON_ERRORS = {
  PRODUCT_UNAVAILABLE: 'TRY_ON_PRODUCT_UNAVAILABLE',
  NO_GARMENT_IMAGE: 'TRY_ON_NO_GARMENT_IMAGE',
  GARMENT_IMAGE_UNAVAILABLE: 'TRY_ON_GARMENT_IMAGE_UNAVAILABLE',
  GARMENT_IMAGE_TOO_SMALL: 'TRY_ON_GARMENT_IMAGE_TOO_SMALL',
  NOT_ENABLED: 'TRY_ON_NOT_ENABLED',
  IN_PROGRESS: 'TRY_ON_IN_PROGRESS',
  STORE_BUSY: 'TRY_ON_STORE_BUSY',
  HOURLY_LIMIT: 'TRY_ON_HOURLY_LIMIT',
  CLOCK_SKEW: 'TRY_ON_CLOCK_SKEW',
  FAILED: 'TRY_ON_FAILED',
} as const;

const coded = (code: string, args?: Record<string, unknown>) => ({
  code,
  message: i18nMessage(`errors.${code}`, args),
});

export interface TryOnSession {
  apiKey: string;
  expiresAt: string;
  model: string;
}

export interface LiveTryOnSession {
  sessionId: string;
  // Token de cliente de Decart (ek_...): abre UNA sesión de lucy-2.5 durante tokenTtlSeconds. Nunca la
  // clave permanente.
  apiKey: string;
  expiresAt: string;
  model: string;
  maxSessionSeconds: number;
  prompt: string;
  // Foto de la prenda como data URL: la app la pasa tal cual como imagen de referencia
  garmentImage: string;
  productId: string;
  tenantId: string;
  userId: string;
}

@Injectable()
export class TryOnService {
  private readonly logger = new Logger(TryOnService.name);
  private readonly registry = new LiveSessionRegistry();

  constructor(
    private readonly secrets: TenantSecretsService,
    private readonly prisma: PrismaService,
  ) {}

  private warnedEnvFallback = false;

  // Clave de Decart: la propia de la tienda (cifrada en tenant_integrations) y, si no tiene, la global
  // DECART_API_KEY del entorno (api/.env). La global la comparten todas las tiendas que tengan el
  // probador en su plan, así que todo su consumo se cobra en esa cuenta de Decart.
  private async resolveApiKey(): Promise<string | null> {
    const own = (await this.secrets.get('DECART'))?.apiKey;
    if (own) return own;
    const shared = process.env.DECART_API_KEY?.trim();
    if (!shared) return null;
    if (!shared.startsWith('dct_')) {
      this.logger.error('DECART_API_KEY no parece una key de Decart (debe empezar con "dct_"): se ignora');
      return null;
    }
    if (!this.warnedEnvFallback) {
      this.warnedEnvFallback = true;
      this.logger.warn('Probador virtual con la DECART_API_KEY global del entorno (tiendas sin clave propia)');
    }
    return shared;
  }

  // Solo fuera de producción: las pruebas apuntan el SDK a un Decart falso local (sin cobros).
  private decartBaseUrl(): string | undefined {
    if (process.env.NODE_ENV === 'production') return undefined;
    return process.env.DECART_BASE_URL?.trim() || undefined;
  }

  async createSession(origin?: string): Promise<TryOnSession> {
    const apiKey = await this.resolveApiKey();
    if (!apiKey) {
      throw new ServiceUnavailableException('El probador virtual no está habilitado en esta tienda.');
    }

    try {
      // @decartai/sdk es solo ESM: import dinámico (con module "nodenext", TS lo deja como import()
      // nativo en vez de convertirlo a require).
      const { createDecartClient } = await import('@decartai/sdk');
      const client = createDecartClient({ apiKey });
      const token = await client.tokens.create({
        expiresIn: TOKEN_TTL_SECONDS,
        allowedModels: [MODEL],
        // allowedOrigins compara el header Origin tal cual; si no llega, se firma sin restricción
        ...(origin ? { allowedOrigins: [origin] } : {}),
        constraints: { realtime: { maxSessionDuration: MAX_SESSION_SECONDS } },
      });
      return { apiKey: token.apiKey, expiresAt: String(token.expiresAt), model: MODEL };
    } catch (error) {
      this.logger.error(`No se pudo crear el token de sesión de Decart: ${(error as Error).message}`);
      throw new BadGatewayException('No se pudo iniciar la sesión del probador virtual.');
    }
  }

  // Probador EN VIVO de la app móvil (lucy-2.5). El video va del teléfono a Decart; aquí solo se
  // valida, se entrega la prenda de referencia y se firma el token. Nada se guarda en la base.
  async createLiveSession(user: { id: string }, productId: unknown, clientTime?: unknown): Promise<LiveTryOnSession> {
    // 1. Prenda de ESTA tienda (PrismaService ya está en el schema del tenant), activa y con foto usable
    if (typeof productId !== 'string' || !UUID_RE.test(productId)) {
      throw new NotFoundException(coded(TRY_ON_ERRORS.PRODUCT_UNAVAILABLE));
    }
    const product = await this.prisma.product.findFirst({
      where: { id: productId, isActive: true },
      select: { id: true, name: true, colors: true, imageUrl: true },
    });
    if (!product) throw new NotFoundException(coded(TRY_ON_ERRORS.PRODUCT_UNAVAILABLE));
    if (!product.imageUrl?.trim()) throw new UnprocessableEntityException(coded(TRY_ON_ERRORS.NO_GARMENT_IMAGE));

    let garment;
    try {
      garment = await loadGarmentImage(product.imageUrl.trim());
    } catch (error) {
      if (error instanceof GarmentTooSmallError) {
        throw new UnprocessableEntityException(coded(TRY_ON_ERRORS.GARMENT_IMAGE_TOO_SMALL));
      }
      if (error instanceof GarmentUnavailableError) {
        this.logger.warn(`Imagen de la prenda ${product.id} no utilizable para el probador: ${error.message}`);
        throw new UnprocessableEntityException(coded(TRY_ON_ERRORS.GARMENT_IMAGE_UNAVAILABLE));
      }
      throw error;
    }

    const apiKey = await this.resolveApiKey();
    if (!apiKey) throw new ServiceUnavailableException(coded(TRY_ON_ERRORS.NOT_ENABLED));

    // 2. Reloj del dispositivo: si va adelantado, el token se alarga solo esa diferencia (primera
    //    estimación contra el reloj del backend; abajo se corrige contra el de Decart)
    const receivedAt = Date.now();
    const ahead = deviceClockAheadSeconds(clientTime, receivedAt);
    if (ahead > MAX_CLOCK_SKEW_SECONDS) throw new UnprocessableEntityException(coded(TRY_ON_ERRORS.CLOCK_SKEW));
    const configured = liveLimits();
    const limits = { ...configured, tokenTtlSeconds: configured.tokenTtlSeconds + ahead };

    // 3. Límites: una sesión a la vez por cliente, tope por tienda y por hora
    const tenantId = requireTenant().tenantId;
    const acquired = this.registry.acquire({ id: randomUUID(), tenantId, userId: user.id, limits });
    if (!acquired.ok) {
      const code =
        acquired.reason === 'user_active' ? TRY_ON_ERRORS.IN_PROGRESS : acquired.reason === 'tenant_busy' ? TRY_ON_ERRORS.STORE_BUSY : TRY_ON_ERRORS.HOURLY_LIMIT;
      const retryAfterSeconds = Math.max(1, acquired.retryAfterSeconds);
      throw new HttpException(
        { ...coded(code, { seconds: retryAfterSeconds, minutes: Math.ceil(retryAfterSeconds / 60) }), retryAfterSeconds },
        acquired.reason === 'hourly_limit' ? HttpStatus.TOO_MANY_REQUESTS : HttpStatus.CONFLICT,
      );
    }
    const { slot } = acquired;

    // 3. Token de cliente: solo lucy-2.5, abre sesiones durante tokenTtlSeconds y cada sesión la corta
    //    Decart a los maxSessionSeconds (aunque el token ya haya vencido).
    let clockSkew = false;
    try {
      const { createDecartClient } = await import('@decartai/sdk');
      const baseUrl = this.decartBaseUrl();
      const client = createDecartClient({ apiKey, telemetry: false, ...(baseUrl ? { baseUrl } : {}) });
      const mint = (expiresIn: number) =>
        client.tokens.create({
          expiresIn,
          allowedModels: [LIVE_MODEL],
          constraints: { realtime: { maxSessionDuration: limits.maxSessionSeconds } },
          metadata: { tenantId, userId: user.id, productId: product.id, sessionId: slot.id },
        });

      let expiresIn = limits.tokenTtlSeconds;
      let token = await mint(expiresIn);
      // El desfase que importa es dispositivo ↔ Decart (el backend también puede tener la hora corrida).
      // Si el teléfono va adelantado respecto a Decart, se vuelve a firmar UNA vez con la diferencia.
      const aheadOfProvider = deviceAheadOfProviderSeconds({
        clientTime,
        receivedAt,
        mintedAt: Date.now(),
        expiresAt: String(token.expiresAt),
        expiresInSeconds: expiresIn,
      });
      if (aheadOfProvider > MAX_CLOCK_SKEW_SECONDS) {
        clockSkew = true;
        throw new Error('reloj del dispositivo fuera de rango');
      }
      const needed = configured.tokenTtlSeconds + Math.max(0, aheadOfProvider);
      if (needed > expiresIn + 2) {
        expiresIn = needed;
        token = await mint(expiresIn);
        this.registry.setTokenTtl(slot.id, expiresIn);
      }
      return {
        sessionId: slot.id,
        apiKey: token.apiKey,
        expiresAt: String(token.expiresAt),
        model: LIVE_MODEL,
        maxSessionSeconds: limits.maxSessionSeconds,
        prompt: buildLivePrompt(product),
        garmentImage: `data:${garment.type};base64,${Buffer.from(garment.bytes).toString('base64')}`,
        productId: product.id,
        tenantId,
        userId: user.id,
      };
    } catch (error) {
      this.registry.cancel(slot.id);
      if (clockSkew) throw new UnprocessableEntityException(coded(TRY_ON_ERRORS.CLOCK_SKEW));
      const err = error as Error & { code?: string };
      // Sin el mensaje completo: podría incluir detalles de la cuenta del proveedor
      this.logger.error(`No se pudo crear el token del probador en vivo (${err.code ?? err.name})`);
      throw new BadGatewayException(coded(TRY_ON_ERRORS.FAILED));
    }
  }

  liveConfig(): { model: string; maxSessionSeconds: number } {
    return { model: LIVE_MODEL, maxSessionSeconds: liveLimits().maxSessionSeconds };
  }

  /** El cliente terminó la sesión en vivo (botón Finalizar, salir, segundo plano, sin red). */
  endLiveSession(user: { id: string }, sessionId: string): { ended: boolean } {
    const tenantId = requireTenant().tenantId;
    return { ended: this.registry.end(sessionId, tenantId, user.id) };
  }
}
