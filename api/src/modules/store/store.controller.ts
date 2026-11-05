import { Controller, Get, NotFoundException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ControlPrismaService } from '../../tenancy/control-prisma.service';
import { requireTenant } from '../../tenancy/tenant-context';
import { getPlanFeatures } from '../platform/plans';

// Datos públicos de la tienda del request (la resuelve TenantMiddleware: header x-tenant-id o
// subdominio). El front los usa para mostrar el nombre de la tienda y adaptar la interfaz según los
// beneficios habilitados en el plan actual de la tienda.
@ApiTags('store')
@Controller('store')
export class StoreController {
  constructor(private readonly control: ControlPrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Nombre, slug, plan y beneficios activos de la tienda actual' })
  async info() {
    const { tenantId } = requireTenant();
    const tenant = await this.control.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, slug: true, plan: true },
    });
    if (!tenant) throw new NotFoundException('Tienda no encontrada');
    return {
      success: true,
      data: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        plan: tenant.plan,
        features: getPlanFeatures(tenant.plan),
      },
      message: 'Tienda actual',
    };
  }
}
