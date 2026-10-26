import { Controller, Headers, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { PaymentsService } from './payments.service';

// Sin guards: Stripe llama a esta ruta directamente (no manda un JWT nuestro).
// La seguridad viene de validar la firma "Stripe-Signature" con STRIPE_WEBHOOK_SECRET.
// Multitenant: la ruta está excluida de TenantMiddleware. Con destination charges todos los eventos
// llegan a este único endpoint de la plataforma; PaymentsService resuelve la tienda desde
// metadata.tenantId + transfer_data.destination (StripeConnectService.resolveTenantForPaymentIntent).
// PaymentIntents de antes del multitenant (sin tenantId) caen en LEGACY_TENANT_ID.
//
// En el dashboard de Stripe se registran DOS endpoints con esta misma URL:
//   1. "Your account" → STRIPE_WEBHOOK_SECRET:
//        payment_intent.succeeded / payment_intent.payment_failed   (ventas de las tiendas)
//        checkout.session.completed / .async_payment_succeeded / .expired,
//        customer.subscription.updated / .deleted                    (alta y facturación del SaaS:
//        crean la tienda con TenantProvisioningService y la suspenden si deja de pagar)
//   2. "Connected accounts": account.updated (fin del onboarding) → STRIPE_CONNECT_WEBHOOK_SECRET
// handleWebhookEvent valida la firma contra cualquiera de los dos secretos.
@ApiExcludeController()
@Controller('payments')
export class PaymentsWebhookController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ): Promise<{ received: boolean }> {
    return await this.paymentsService.handleWebhookEvent(req.rawBody!, signature);
  }
}
