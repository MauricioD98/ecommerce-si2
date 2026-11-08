import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { PlatformAuditService, auditActorFromRequest } from './audit/platform-audit.service';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { SubscriptionCheckoutDto } from './dto/subscription-checkout.dto';
import { PLATFORM_KEY_HEADER, PlatformAdminGuard } from './guards/platform-admin.guard';
import { SubscriptionsService } from './subscriptions.service';

// /api/v1/platform/* no pasa por TenantMiddleware: es el plano de control, no hay tienda todavía.
@ApiTags('platform')
@Controller('platform/subscriptions')
export class SubscriptionsController {
  constructor(
    private readonly subscriptions: SubscriptionsService,
    private readonly audit: PlatformAuditService,
  ) {}

  // Público: precios reales (Stripe) de cada plan, mensual y anual, y si se pueden contratar
  @Get('plans')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Catálogo de planes: precio mensual y anual y disponibilidad' })
  async plans() {
    const data = await this.subscriptions.planPrices();
    return { success: true, data, message: 'Planes' };
  }

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

  // ---- Supervisión desde el panel de plataforma ----------------------------------------------

  @Get('tenants')
  @UseGuards(PlatformAdminGuard)
  @ApiHeader({ name: PLATFORM_KEY_HEADER, required: true })
  @ApiOperation({ summary: 'Suscripciones de todas las tiendas (datos guardados por los webhooks; no consulta Stripe)' })
  async tenantSubscriptions() {
    return { success: true, data: await this.subscriptions.listTenantSubscriptions(), message: 'Suscripciones' };
  }

  // Solo lectura en Stripe: relee la suscripción vinculada y aplica las mismas reglas que un webhook
  @Post('tenants/:id/sync')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PlatformAdminGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiHeader({ name: PLATFORM_KEY_HEADER, required: true })
  @ApiOperation({ summary: 'Volver a leer en Stripe la suscripción de una tienda (no modifica Stripe)' })
  async syncTenant(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.audit.track(
      { actor: auditActorFromRequest(req), action: 'SUBSCRIPTION_SYNCED', tenantId: id },
      async () => {
        return { success: true, data: await this.subscriptions.syncTenantFromStripe(id), message: 'Suscripción sincronizada' };
      },
      (res) => ({ details: { subscriptionStatus: res.data?.subscriptionStatus ?? null } }),
    );
  }

  @Post('signups/:id/retry')
  @HttpCode(HttpStatus.OK)
  @UseGuards(PlatformAdminGuard)
  @ApiHeader({ name: PLATFORM_KEY_HEADER, required: true })
  @ApiOperation({ summary: 'Reintentar un alta pagada cuyo aprovisionamiento falló' })
  async retry(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.audit.track(
      { actor: auditActorFromRequest(req), action: 'SIGNUP_RETRIED', details: { signupId: id } },
      async () => {
        await this.subscriptions.retrySignup(id);
        return { success: true, data: { id }, message: 'Alta reintentada' };
      },
    );
  }
}
