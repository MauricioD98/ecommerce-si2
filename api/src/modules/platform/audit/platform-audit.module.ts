import { Global, Module } from '@nestjs/common';
import { PlatformAuditService } from './platform-audit.service';

// Global: la usan PlatformModule (tiendas, suscripciones, login) y BackupsModule (respaldos)
@Global()
@Module({
  providers: [PlatformAuditService],
  exports: [PlatformAuditService],
})
export class PlatformAuditModule {}
