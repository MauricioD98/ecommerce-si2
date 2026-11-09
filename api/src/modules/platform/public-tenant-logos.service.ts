import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { runInTenant } from '../../tenancy/tenant-context';

// Logos para el directorio público de tiendas (selector de tienda de la app móvil y del front).
//
// El logo vive en el schema de cada tienda (store_appearance.logoUrl): una URL externa https o un data
// URL de hasta 256 KB subido desde el panel. El directorio no puede incrustar los data URL (serían
// cientos de KB por tienda), así que:
//   - URL externa → se devuelve tal cual;
//   - data URL    → se expone como /platform/tenants/:id/logo (bytes con caché HTTP).
// Leer N schemas en cada petición sería caro: se cachea en memoria unos minutos.

const CACHE_MS = 5 * 60 * 1000;
// Solo los formatos que acepta la subida del panel (detectImageType). Nunca SVG: servido desde el
// dominio de la API podría ejecutar scripts.
const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/;

export interface TenantRef {
  id: string;
  schemaName: string;
}

export type StoredLogo = { kind: 'url'; url: string } | { kind: 'data'; type: string; bytes: Buffer } | null;

@Injectable()
export class PublicTenantLogosService {
  private readonly logger = new Logger(PublicTenantLogosService.name);
  private readonly cache = new Map<string, { at: number; logo: StoredLogo }>();

  constructor(private readonly prisma: PrismaService) {}

  /** Logo guardado de una tienda (cacheado). Nunca lanza: sin logo o con error, null. */
  async getLogo(tenant: TenantRef): Promise<StoredLogo> {
    const hit = this.cache.get(tenant.id);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.logo;

    let logo: StoredLogo = null;
    try {
      const row = await runInTenant({ tenantId: tenant.id, schemaName: tenant.schemaName }, () =>
        this.prisma.storeAppearance.findUnique({ where: { id: 'default' }, select: { logoUrl: true } }),
      );
      logo = parseLogo(row?.logoUrl ?? null);
    } catch (error) {
      // Una tienda recién creada sin migrar, por ejemplo: el directorio sigue funcionando sin su logo
      this.logger.warn(`No se pudo leer el logo de la tienda ${tenant.id}: ${(error as Error).message}`);
    }
    this.cache.set(tenant.id, { at: Date.now(), logo });
    return logo;
  }

  /** URL pública del logo para el directorio: absoluta si es externa, ruta de la API si es data URL. */
  async publicLogoUrl(tenant: TenantRef): Promise<string | null> {
    const logo = await this.getLogo(tenant);
    if (!logo) return null;
    return logo.kind === 'url' ? logo.url : `/platform/tenants/${tenant.id}/logo`;
  }

  /** La apariencia cambió (o se quiere forzar la relectura). */
  invalidate(tenantId?: string) {
    if (tenantId) this.cache.delete(tenantId);
    else this.cache.clear();
  }
}

export function parseLogo(value: string | null): StoredLogo {
  const raw = value?.trim();
  if (!raw) return null;
  if (/^https:\/\//i.test(raw)) return { kind: 'url', url: raw };
  const match = raw.match(DATA_URL_RE);
  if (match) return { kind: 'data', type: match[1], bytes: Buffer.from(match[2].replace(/\s+/g, ''), 'base64') };
  // http:// u otros esquemas: no se publican (la app móvil y el front exigen https en producción)
  return null;
}
