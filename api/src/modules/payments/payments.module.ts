import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { PaymentsController } from './payments.controller';
import { PaymentsWebhookController } from './payments.webhook.controller';
import { PaymentsService } from './payments.service';
import { StripeConnectService } from './stripe-connect.service';
import { StripeConnectController } from './stripe-connect.controller';
import { InvoicesModule } from '../invoices/invoices.module';
import { BranchesModule } from '../branches/branches.module';
import { PlatformModule } from '../platform/platform.module';

@Module({
  imports: [
    InvoicesModule,
    BranchesModule,
    // Webhook único de Stripe: los eventos de suscripción al SaaS los procesa SubscriptionsService
    PlatformModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
  ],
  controllers: [PaymentsController, PaymentsWebhookController, StripeConnectController],
  providers: [PaymentsService, StripeConnectService]
})
export class PaymentsModule {}
