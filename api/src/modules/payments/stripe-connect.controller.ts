import { BadRequestException, Controller, ForbiddenException, Get, HttpCode, HttpStatus, Logger, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import Stripe from 'stripe';
import { JwtAuthGuard } from '../../common/decorators/guards/jwt-auth.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';
import type { AuthUser } from '../../common/decorators/interfaces/request-with-user.interface';
import { SUPER_ADMIN_ROLE } from '../../common/constants/permissions';
import { requireTenant, withTenantParam } from '../../tenancy/tenant-context';
import { i18nMessage } from '../../i18n/i18n-message';
import { StripeConnectService } from './stripe-connect.service';

// Cobro con tarjeta de cada tienda (Stripe Connect, destination charges). Pasa por TenantMiddleware:
// la tienda es la del request, y con JWT la del token (JwtStrategy garantiza que coinciden).
@ApiTags('payments')
@Controller('payments/connect')
export class StripeConnectController {
  private readonly logger = new Logger(StripeConnectController.name);

  constructor(private readonly connect: StripeConnectService) {}

  // Público (cualquier visitante de la tienda): el checkout lo consulta para ofrecer o no la tarjeta
  @Get('availability')
  @ApiOperation({ summary: '¿La tienda acepta pagos con tarjeta?' })
  async availability() {
    const { tenantId } = requireTenant();
    return { success: true, data: { cardEnabled: await this.connect.isCardEnabled(tenantId) }, message: 'OK' };
  }

  @Get('status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Estado de la cuenta de cobros (Stripe Connect) de la tienda' })
  async status(@GetUser() user: AuthUser) {
    this.assertOwner(user);
    return { success: true, data: await this.connect.getStatus(user.tenantId), message: 'Estado de la cuenta de cobros' };
  }

  // Crea (si hace falta) la cuenta Express y devuelve el formulario de Stripe para completar los datos
  @Post('onboarding')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Abrir el onboarding de Stripe para habilitar los cobros con tarjeta' })
  async onboarding(@GetUser() user: AuthUser) {
    this.assertOwner(user);
    const base = `${(process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '')}/admin/pagos`;
    try {
      const data = await this.connect.createOnboardingLink(
        user.tenantId,
        withTenantParam(`${base}?connect=return`, user.tenantId),
        // El link de Stripe vence a los pocos minutos: refresh_url vuelve al panel para pedir otro
        withTenantParam(`${base}?connect=refresh`, user.tenantId),
      );
      return { success: true, data, message: 'Redirigiendo a Stripe' };
    } catch (error) {
      // Cuenta de Stripe sin Connect activado: se explica en vez de devolver un 500 genérico
      if (error instanceof Stripe.errors.StripeError) {
        this.logger.error(`Onboarding de Connect falló: ${error.message}`);
        if (/signed up for Connect/i.test(error.message)) throw new BadRequestException(i18nMessage('errors.CONNECT_NOT_ENABLED'));
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  private assertOwner(user: AuthUser) {
    if (user.role?.name !== SUPER_ADMIN_ROLE) throw new ForbiddenException(i18nMessage('errors.BILLING_OWNER_ONLY'));
  }
}
