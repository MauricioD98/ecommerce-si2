import { Module } from '@nestjs/common';
import { PlatformController } from './platform.controller';
import { SubscriptionsController } from './subscriptions.controller';
import { TenantSubscriptionController } from './tenant-subscription.controller';
import { ContactController } from './contact.controller';
import { SubscriptionsService } from './subscriptions.service';
import { PlatformAdminGuard } from './guards/platform-admin.guard';
import { InternalKeyGuard } from './guards/internal-key.guard';

// ControlPrismaService y TenantProvisioningService vienen de TenancyModule (@Global); MailService
// de MailModule (@Global). SubscriptionsService se exporta para el webhook de Stripe (PaymentsModule).
@Module({
  controllers: [PlatformController, SubscriptionsController, TenantSubscriptionController, ContactController],
  providers: [PlatformAdminGuard, InternalKeyGuard, SubscriptionsService],
  exports: [SubscriptionsService],
})
export class PlatformModule {}
