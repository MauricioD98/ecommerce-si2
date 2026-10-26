import { Global, MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ControlPrismaService } from './control-prisma.service';
import { TenantMiddleware } from './tenant.middleware';
import { TenantMigrationService } from './tenant-migration.service';
import { TenantPrismaService } from './tenant-prisma.service';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { TenantSecretsService } from './tenant-secrets.service';
import { TenantResolutionCache } from './tenant-resolution-cache.service';
import { EncryptionService } from '../common/encryption/encryption.service';

@Global()
@Module({
  providers: [
    ControlPrismaService,
    TenantPrismaService,
    TenantMigrationService,
    TenantProvisioningService,
    EncryptionService,
    TenantSecretsService,
    TenantResolutionCache,
  ],
  exports: [
    ControlPrismaService,
    TenantPrismaService,
    TenantProvisioningService,
    EncryptionService,
    TenantSecretsService,
    TenantResolutionCache,
  ],
})
export class TenancyModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(TenantMiddleware)
      // Con setGlobalPrefix('api/v1') estas rutas se resuelven como /api/v1/...
      // Sin tenant: plano de control (alta de tiendas, login SaaS), health y el webhook de Stripe
      // (llega sin header; debe resolver la tienda desde metadata.tenantId del evento).
      .exclude(
        { path: 'platform/{*splat}', method: RequestMethod.ALL },
        { path: '/', method: RequestMethod.GET },
        { path: 'payments/webhook', method: RequestMethod.POST },
      )
      .forRoutes('{*splat}');
  }
}
