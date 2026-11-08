import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { PlatformAuthService } from '../platform/platform-auth.service';
import { PlatformAdminGuard } from '../platform/guards/platform-admin.guard';
import { BackupsController } from './backups.controller';
import { BackupsService } from './backups.service';
import { PlatformBackupsController } from './platform-backups.controller';

// TenantMigrationService y TenantResolutionCache vienen de TenancyModule (@Global). PlatformAdminGuard
// necesita PlatformAuthService (mismas dependencias que en PlatformModule).
@Module({
  imports: [JwtModule.register({}), AuthModule],
  controllers: [BackupsController, PlatformBackupsController],
  providers: [BackupsService, PlatformAuthService, PlatformAdminGuard],
  exports: [BackupsService],
})
export class BackupsModule {}
