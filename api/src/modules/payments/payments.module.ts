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
import { OrdersModule } from '../orders/orders.module';
import { PaymentSettingsService } from './payment-settings.service';
import { PaymentProofsService } from './payment-proofs.service';
import { PaymentOptionsController, PaymentProofsController, PaymentSettingsController } from './payment-settings.controller';

@Module({
  imports: [
    InvoicesModule,
    BranchesModule,
    // Webhook único de Stripe: los eventos de suscripción al SaaS los procesa SubscriptionsService
    PlatformModule,
    OrdersModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
  ],
  controllers: [
    PaymentsController,
    PaymentsWebhookController,
    StripeConnectController,
    PaymentSettingsController,
    PaymentOptionsController,
    PaymentProofsController,
  ],
  providers: [PaymentsService, StripeConnectService, PaymentSettingsService, PaymentProofsService]
})
export class PaymentsModule {}
