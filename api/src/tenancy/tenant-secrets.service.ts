import { Injectable } from '@nestjs/common';
import { IntegrationProvider } from '../generated/control/client';
import { EncryptionService } from '../common/encryption/encryption.service';
import { ControlPrismaService } from './control-prisma.service';
import { requireTenant } from './tenant-context';
import { integrationAad } from './integration-aad';

export { IntegrationProvider, integrationAad };

// Forma del payload cifrado de cada proveedor
export interface DecartCredentials {
  apiKey: string;
}

export interface WebPushCredentials {
  publicKey: string;
  privateKey: string;
  subject: string; // mailto:… o https://…, lo exige el protocolo VAPID
}

export interface IntegrationPayloads {
  DECART: DecartCredentials;
  WEBPUSH: WebPushCredentials;
  STRIPE: Record<string, string>; // reservado (ver enum en prisma/control/schema.prisma)
}

const CACHE_TTL_MS = 5 * 60_000;

/**
 * Credenciales de terceros por tienda (public.tenant_integrations). El cifrado lo hace
 * EncryptionService con "<tenantId>:<provider>" como AAD. Los payloads descifrados se cachean 5 min
 * en memoria para no ir a la base (ni descifrar) en cada push.
 */
@Injectable()
export class TenantSecretsService {
  private readonly cache = new Map<string, { value: unknown; expires: number }>();

  constructor(
    private readonly control: ControlPrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  /** Credencial de la tienda del request actual (o de tenantId explícito, p. ej. desde un cron). */
  async get<P extends IntegrationProvider>(
    provider: P,
    tenantId = requireTenant().tenantId,
  ): Promise<IntegrationPayloads[P] | null> {
    const aad = integrationAad(tenantId, provider);
    const hit = this.cache.get(aad);
    if (hit && hit.expires > Date.now()) return hit.value as IntegrationPayloads[P] | null;

    const row = await this.control.tenantIntegration.findUnique({
      where: { tenantId_provider: { tenantId, provider } },
      select: { encryptedData: true, iv: true },
    });
    const value = row ? this.encryption.decrypt<IntegrationPayloads[P]>(row.encryptedData, row.iv, aad) : null;

    this.cache.set(aad, { value, expires: Date.now() + CACHE_TTL_MS });
    return value;
  }

  async set<P extends IntegrationProvider>(tenantId: string, provider: P, payload: IntegrationPayloads[P]): Promise<void> {
    const data = this.encryption.encrypt(payload, integrationAad(tenantId, provider));
    await this.control.tenantIntegration.upsert({
      where: { tenantId_provider: { tenantId, provider } },
      create: { tenantId, provider, ...data },
      update: data,
    });
    // Esta instancia ve el cambio al instante; las demás réplicas, al vencer su caché (≤5 min)
    this.cache.delete(integrationAad(tenantId, provider));
  }

  async remove(tenantId: string, provider: IntegrationProvider): Promise<void> {
    await this.control.tenantIntegration.deleteMany({ where: { tenantId, provider } });
    this.cache.delete(integrationAad(tenantId, provider));
  }
}
