import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PlatformController } from './platform.controller';
import { PlatformAuthController } from './platform-auth.controller';
import { SubscriptionsController } from './subscriptions.controller';
import { TenantSubscriptionController } from './tenant-subscription.controller';
import { ContactController } from './contact.controller';
import { SubscriptionsService } from './subscriptions.service';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformAdminGuard } from './guards/platform-admin.guard';
import { InternalKeyGuard } from './guards/internal-key.guard';

// ControlPrismaService y TenantProvisioningService vienen de TenancyModule (@Global); MailService
// de MailModule (@Global). SubscriptionsService se exporta para el webhook de Stripe (PaymentsModule).
// JwtModule sin config: PlatformAuthService pasa secret y audience en cada sign/verify.
@Module({
  imports: [JwtModule.register({})],
  controllers: [PlatformController, PlatformAuthController, SubscriptionsController, TenantSubscriptionController, ContactController],
  providers: [PlatformAuthService, PlatformAdminGuard, InternalKeyGuard, SubscriptionsService],
  exports: [SubscriptionsService],
})
export class PlatformModule {}
