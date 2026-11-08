import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ControlPrismaService } from '../../tenancy/control-prisma.service';
import { TenantPrismaService } from '../../tenancy/tenant-prisma.service';

// Cuántas tiendas se consultan a la vez: comparten el pg.Pool de TenantPrismaService (DB_POOL_MAX,
// 10 por defecto) con el resto de la API, así que no se lo acapara.
const CONCURRENCY = 4;
// Una tienda lenta o con el schema roto no frena la vista entera: se corta y se marca no disponible
const STATEMENT_TIMEOUT = '5s';

export type BranchAvailability = 'available' | 'not_provisioned' | 'unavailable';

export interface PlatformBranch {
  id: string;
  name: string;
  address: string | null;
  isActive: boolean;
  createdAt: Date;
}

export interface TenantBranches {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  tenantStatus: string;
  /**
   * available: se consultó su schema (branches puede venir vacío = la tienda no tiene sucursales).
   * not_provisioned: la tienda no terminó de crearse (PROVISIONING / FAILED): no hay schema que leer.
   * unavailable: la consulta falló (schema dañado, tabla faltante, timeout): NO significa "0 sucursales".
   */
  availability: BranchAvailability;
  branches: PlatformBranch[];
}

/**
 * Supervisión de sucursales de todas las tiendas (solo lectura).
 *
 * Multitenancy: cada tienda guarda sus datos en su propio schema "tenant_<uuid>"; el plano de control
 * (public.tenants) dice cuál. El schema SIEMPRE sale de public.tenants.schema_name, nunca del request:
 * el navegador a lo sumo manda un tenantId (UUID validado) que solo sirve para elegir la fila del plano
 * de control. Además TenantPrismaService.forSchema valida el nombre contra un patrón cerrado
 * (tenant_<32 hex> | tenant_legacy) antes de usarlo, y el cliente de Prisma califica cada consulta
 * con ese schema: una tienda no puede leer datos de otra.
 */
@Injectable()
export class PlatformBranchesService {
  private readonly logger = new Logger(PlatformBranchesService.name);

  constructor(
    private readonly control: ControlPrismaService,
    private readonly tenants: TenantPrismaService,
  ) {}

  async list(tenantId?: string): Promise<{ generatedAt: string; tenants: TenantBranches[] }> {
    const rows = await this.control.tenant.findMany({
      where: tenantId ? { id: tenantId } : undefined,
      orderBy: { name: 'asc' },
      select: { id: true, slug: true, name: true, status: true, schemaName: true },
    });
    if (tenantId && rows.length === 0) throw new NotFoundException('Tienda no encontrada');

    const results: TenantBranches[] = new Array(rows.length);
    let next = 0;
    const worker = async () => {
      while (next < rows.length) {
        const index = next++;
        results[index] = await this.forTenant(rows[index]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));

    return { generatedAt: new Date().toISOString(), tenants: results };
  }

  private async forTenant(tenant: { id: string; slug: string; name: string; status: string; schemaName: string }): Promise<TenantBranches> {
    const base = { tenantId: tenant.id, tenantSlug: tenant.slug, tenantName: tenant.name, tenantStatus: tenant.status };
    // Una tienda suspendida conserva su schema y sus datos: se puede supervisar igual
    if (tenant.status !== 'ACTIVE' && tenant.status !== 'SUSPENDED') {
      return { ...base, availability: 'not_provisioned', branches: [] };
    }
    try {
      const db = this.tenants.forSchema(tenant.schemaName);
      const branches = await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
        return tx.branch.findMany({
          orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
          select: { id: true, name: true, address: true, isActive: true, createdAt: true },
        });
      });
      return { ...base, availability: 'available', branches };
    } catch (error) {
      // El detalle queda en el log del servidor; al navegador solo va "no disponible"
      this.logger.warn(`Sucursales de la tienda ${tenant.id} no disponibles: ${(error as Error).message}`);
      return { ...base, availability: 'unavailable', branches: [] };
    }
  }
}
