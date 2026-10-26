import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { requireTenant } from '../../tenancy/tenant-context';
import { StripeConnectService } from './stripe-connect.service';

// Cobro con tarjeta de cada tienda (Stripe Connect, destination charges). Pasa por TenantMiddleware.
// El onboarding, el estado y la desvinculación están en PaymentSettingsController (MANAGE_PAYMENTS).
@ApiTags('payments')
@Controller('payments/connect')
export class StripeConnectController {
  constructor(private readonly connect: StripeConnectService) {}

  // Público (cualquier visitante de la tienda): el checkout lo consulta para ofrecer o no la tarjeta
  @Get('availability')
  @ApiOperation({ summary: '¿La tienda acepta pagos con tarjeta?' })
  async availability() {
    const { tenantId } = requireTenant();
    return { success: true, data: { cardEnabled: await this.connect.isCardEnabled(tenantId) }, message: 'OK' };
  }
}
