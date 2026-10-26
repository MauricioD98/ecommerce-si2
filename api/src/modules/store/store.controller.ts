import { Controller, Get, NotFoundException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ControlPrismaService } from '../../tenancy/control-prisma.service';
import { requireTenant } from '../../tenancy/tenant-context';

// Datos públicos de la tienda del request (la resuelve TenantMiddleware: header x-tenant-id o
// subdominio). El front los usa para mostrar el nombre de la tienda en vez de la marca de la
// plataforma: header, panel, recibos, títulos de página.
@ApiTags('store')
@Controller('store')
export class StoreController {
  constructor(private readonly control: ControlPrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Nombre y slug de la tienda actual' })
  async info() {
    const { tenantId } = requireTenant();
    const tenant = await this.control.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, slug: true },
    });
    if (!tenant) throw new NotFoundException('Tienda no encontrada');
    return { success: true, data: tenant, message: 'Tienda actual' };
  }
}
