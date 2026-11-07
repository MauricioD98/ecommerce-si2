import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { TenantSecretsService } from '../../tenancy/tenant-secrets.service';

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

export interface TryOnSession {
  apiKey: string;
  expiresAt: string;
  model: string;
}

@Injectable()
export class TryOnService {
  private readonly logger = new Logger(TryOnService.name);

  constructor(private readonly secrets: TenantSecretsService) {}

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
}
