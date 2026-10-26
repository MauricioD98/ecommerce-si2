import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ControlPrismaService } from './control-prisma.service';
import { TenantContext, tenantStorage } from './tenant-context';
import { TenantResolutionCache } from './tenant-resolution-cache.service';

export const TENANT_HEADER = 'x-tenant-id';
export const TENANT_REQUIRED = 'TENANT_REQUIRED';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Segunda barrera para las rutas sin tienda, además del .exclude() de TenancyModule: si el exclude no
// matcheara con el prefijo global (no verificable sin levantar la app), Stripe recibiría 401 en el
// webhook y ningún pago se confirmaría. Rutas ABSOLUTAS (con /api/v1), comparadas sin query string.
const TENANTLESS_ROUTES: { method: string | null; path: RegExp }[] = [
  { method: null, path: /^\/api\/v1\/platform(\/|$)/ },
  { method: 'POST', path: /^\/api\/v1\/payments\/webhook\/?$/ },
  { method: 'GET', path: /^\/api\/v1\/?$/ }, // health
  { method: null, path: /^\/api\/docs(\/|$|-json)/ }, // Swagger (fuera del prefijo global)
];
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

type Lookup = { by: 'id' | 'slug'; value: string };

/**
 * Resuelve la tienda de cada petición bajo /api/v1 y la deja en req.tenant + AsyncLocalStorage.
 * Orden: header x-tenant-id (UUID, lo usa la app móvil y el POS) → subdominio (slug).
 * Cualquier fallo —ausente, malformado, inexistente o no ACTIVE— es 401 con el mismo mensaje,
 * para no revelar qué tiendas existen.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  // El cache evita pegarle a "public" en cada request. PATCH /platform/tenants/:id/status lo invalida
  // al suspender/reactivar; si no, una entrada vence a los 60 s.
  constructor(
    private readonly control: ControlPrismaService,
    private readonly cache: TenantResolutionCache,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const path = (req.originalUrl ?? req.url).split('?')[0];
    if (TENANTLESS_ROUTES.some((r) => (r.method === null || r.method === req.method) && r.path.test(path))) {
      return next();
    }

    let ctx: TenantContext;
    try {
      const lookup = this.extract(req);
      if (!lookup) throw this.reject();
      ctx = await this.resolve(lookup);
    } catch (err) {
      return next(err);
    }

    req.tenant = ctx;
    tenantStorage.run(ctx, () => next());
  }

  private extract(req: Request): Lookup | null {
    const header = req.header(TENANT_HEADER)?.trim().toLowerCase();
    if (header) {
      // Header presente pero inválido: se rechaza, no se cae al subdominio
      return UUID_RE.test(header) ? { by: 'id', value: header } : null;
    }

    const baseDomain = process.env.TENANT_BASE_DOMAIN?.toLowerCase(); // ej: "tuapp.com"
    const host = req.hostname?.toLowerCase();
    if (baseDomain && host?.endsWith(`.${baseDomain}`)) {
      const slug = host.slice(0, -(baseDomain.length + 1));
      if (SLUG_RE.test(slug)) return { by: 'slug', value: slug };
    }
    return null;
  }

  private async resolve(lookup: Lookup): Promise<TenantContext> {
    const key = `${lookup.by}:${lookup.value}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) {
      if (!hit) throw this.reject();
      return hit;
    }

    const tenant = await this.control.tenant.findUnique({
      where: lookup.by === 'id' ? { id: lookup.value } : { slug: lookup.value },
      select: { id: true, schemaName: true, status: true },
    });

    const ctx =
      tenant?.status === 'ACTIVE' ? { tenantId: tenant.id, schemaName: tenant.schemaName } : null;
    this.cache.set(key, ctx);

    if (!ctx) throw this.reject();
    return ctx;
  }

  // `code` permite a los clientes distinguir "falta elegir tienda" de "sesión vencida": ante
  // TENANT_REQUIRED muestran el selector de tienda en vez de intentar el refresh y hacer logout.
  private reject() {
    return new UnauthorizedException({
      statusCode: 401,
      error: 'Unauthorized',
      code: TENANT_REQUIRED,
      message: 'Tienda inválida o no disponible',
    });
  }
}
