import { Body, Controller, ForbiddenException, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/decorators/guards/jwt-auth.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';
import type { AuthUser } from '../../common/decorators/interfaces/request-with-user.interface';
import { SUPER_ADMIN_ROLE } from '../../common/constants/permissions';
import { i18nMessage } from '../../i18n/i18n-message';
import { TenantCheckoutDto } from './dto/tenant-checkout.dto';
import { SubscriptionsService } from './subscriptions.service';

// Suscripción al SaaS de la tienda YA existente, desde su panel. A diferencia de
// /platform/subscriptions (alta pública, todavía no hay tienda), esta ruta pasa por TenantMiddleware
// y JwtStrategy, que garantiza que el token es de la misma tienda del request (user.tenantId).
// Solo el Super Admin (dueño): pagar o cancelar el SaaS no es algo que decida un rol configurable.
@ApiTags('subscription')
@ApiBearerAuth('JWT-auth')
@Controller('subscription')
@UseGuards(JwtAuthGuard)
export class TenantSubscriptionController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  @ApiOperation({ summary: 'Plan y estado de la suscripción de la tienda (sincronizado por el webhook)' })
  async status(@GetUser() user: AuthUser) {
    this.assertOwner(user);
    const data = await this.subscriptions.getTenantSubscription(user.tenantId);
    return { success: true, data, message: 'Estado de la suscripción' };
  }

  @Post('checkout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 10 * 60_000 } })
  @ApiOperation({ summary: 'Suscribir la tienda a un plan (devuelve la URL de Stripe Checkout)' })
  async checkout(@GetUser() user: AuthUser, @Body() dto: TenantCheckoutDto) {
    this.assertOwner(user);
    const data = await this.subscriptions.createTenantCheckout(user.tenantId, user.email, dto.plan);
    return { success: true, data, message: 'Redirigiendo al pago' };
  }

  @Post('portal')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Abrir el Billing Portal de Stripe (cambiar de plan, tarjeta o cancelar)' })
  async portal(@GetUser() user: AuthUser) {
    this.assertOwner(user);
    const data = await this.subscriptions.createPortalSession(user.tenantId);
    return { success: true, data, message: 'Redirigiendo al portal de facturación' };
  }

  private assertOwner(user: AuthUser) {
    if (user.role?.name !== SUPER_ADMIN_ROLE) throw new ForbiddenException(i18nMessage('errors.BILLING_OWNER_ONLY'));
  }
}
