import { Controller, Get, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PLATFORM_KEY_HEADER, PlatformAdminGuard } from './guards/platform-admin.guard';
import { PlatformBranchesService } from './platform-branches.service';

/**
 * Sucursales de todas las tiendas, para supervisión del administrador del SaaS. Solo lectura: crear,
 * editar o eliminar sucursales sigue siendo cosa del panel de cada tienda.
 *
 * PlatformAdminGuard: un usuario de una tienda (incluido su Super Admin) no es administrador de la
 * plataforma, así que su JWT recibe 401 y no puede ver sucursales de ninguna tienda por esta ruta.
 * /platform/* no pasa por TenantMiddleware: el header x-tenant-id no tiene efecto acá.
 */
@ApiTags('Platform')
@Controller('platform/branches')
@UseGuards(PlatformAdminGuard)
@ApiBearerAuth('JWT-auth')
@ApiHeader({ name: PLATFORM_KEY_HEADER, required: false })
export class PlatformBranchesController {
  constructor(private readonly branches: PlatformBranchesService) {}

  @Get()
  @ApiQuery({ name: 'tenantId', required: false, description: 'Solo las sucursales de esta tienda (UUID)' })
  @ApiOperation({ summary: 'Sucursales de todas las tiendas (o de una), con su disponibilidad por tienda' })
  async list(@Query('tenantId', new ParseUUIDPipe({ optional: true })) tenantId?: string) {
    return { success: true, data: await this.branches.list(tenantId), message: 'Sucursales de la plataforma' };
  }
}
