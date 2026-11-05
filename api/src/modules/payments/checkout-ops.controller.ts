import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/decorators/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/decorators/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/constants/permissions';
import { CheckoutMaintenanceService } from './checkout-maintenance.service';

@ApiTags('checkout-ops')
@ApiBearerAuth('JWT-auth')
@Controller('checkout-ops')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CheckoutOpsController {
  constructor(private readonly maintenance: CheckoutMaintenanceService) {}

  @Get('metrics')
  @Permissions(Permission.VIEW_REPORTS)
  @ApiOperation({
    summary: 'Salud de la compra en esta tienda',
    description: 'Intentos inciertos antiguos, pagos sin orden coherente, reservas vencidas, compensaciones pendientes, desfases de stock y retraso de inbox/outbox.',
  })
  async metrics() {
    return { success: true, data: await this.maintenance.metrics() };
  }
}
