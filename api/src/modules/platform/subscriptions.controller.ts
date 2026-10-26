import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { SubscriptionCheckoutDto } from './dto/subscription-checkout.dto';
import { PLATFORM_KEY_HEADER, PlatformAdminGuard } from './guards/platform-admin.guard';
import { SubscriptionsService } from './subscriptions.service';

// /api/v1/platform/* no pasa por TenantMiddleware: es el plano de control, no hay tienda todavía.
@ApiTags('platform')
@Controller('platform/subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  // Público (es la landing de ventas). Cada llamada crea una fila y una sesión de Stripe, así que
  // se limita por IP para que no se pueda inundar la tabla ni la cuenta de Stripe.
  @Post('checkout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 10 * 60_000 } })
  @ApiOperation({ summary: 'Iniciar la suscripción de una tienda nueva (devuelve la URL de Stripe Checkout)' })
  async checkout(@Body() dto: SubscriptionCheckoutDto) {
    const data = await this.subscriptions.createCheckout(dto);
    return { success: true, data, message: 'Redirigiendo al pago' };
  }

  // El session_id solo lo conoce quien volvió de Stripe (va en la success_url) y no es adivinable
  @Get('checkout/:sessionId/status')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Estado del alta tras el pago (lo consulta la página de éxito)' })
  async status(@Param('sessionId') sessionId: string) {
    const data = await this.subscriptions.getCheckoutStatus(sessionId);
    return { success: true, data, message: 'Estado del alta' };
  }

  @Post('signups/:id/retry')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PlatformAdminGuard)
  @ApiHeader({ name: PLATFORM_KEY_HEADER, required: true })
  @ApiOperation({ summary: 'Reintentar un alta pagada cuyo aprovisionamiento falló' })
  async retry(@Param('id', ParseUUIDPipe) id: string) {
    await this.subscriptions.retrySignup(id);
    return { success: true, data: { id }, message: 'Alta reintentada' };
  }
}
