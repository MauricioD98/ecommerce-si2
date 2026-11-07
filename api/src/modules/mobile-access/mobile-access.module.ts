import { Module } from '@nestjs/common';
import { MobileAccessService } from './mobile-access.service';

// ControlPrismaService llega por TenancyModule (@Global)
@Module({
  providers: [MobileAccessService],
  exports: [MobileAccessService],
})
export class MobileAccessModule {}
