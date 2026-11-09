import { Module } from '@nestjs/common';
import { PublicTenantLogosService } from './public-tenant-logos.service';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { PlatformController } from './platform.controller';
import { PlatformAuthController } from './platform-auth.controller';
import { SubscriptionsController } from './subscriptions.controller';
import { TenantSubscriptionController } from './tenant-subscription.controller';
import { ContactController } from './contact.controller';
import { SubscriptionsService } from './subscriptions.service';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformAdminGuard } from './guards/platform-admin.guard';
import { InternalKeyGuard } from './guards/internal-key.guard';
import { PlatformBranchesController } from './platform-branches.controller';
import { PlatformBranchesService } from './platform-branches.service';
import { PlatformAuditController } from './audit/platform-audit.controller';
import { PlatformSystemController } from './system/platform-system.controller';
import { PlatformSystemService } from './system/platform-system.service';

// ControlPrismaService y TenantProvisioningService vienen de TenancyModule (@Global); MailService
// de MailModule (@Global). SubscriptionsService se exporta para el webhook de Stripe (PaymentsModule).
// JwtModule sin config: PlatformAuthService pasa secret y audience en cada sign/verify.
@Module({
  imports: [JwtModule.register({}), AuthModule],
  controllers: [PlatformController, PlatformAuthController, SubscriptionsController, TenantSubscriptionController, ContactController, PlatformBranchesController, PlatformAuditController, PlatformSystemController],
  providers: [PublicTenantLogosService, PlatformAuthService, PlatformAdminGuard, InternalKeyGuard, SubscriptionsService, PlatformBranchesService, PlatformSystemService],
  exports: [SubscriptionsService],
})
export class PlatformModule {}
