import { Controller, Headers, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { PaymentsService } from './payments.service';

// Sin guards: Stripe llama a esta ruta directamente (no manda un JWT nuestro).
// La seguridad viene de validar la firma "Stripe-Signature" con STRIPE_WEBHOOK_SECRET.
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
