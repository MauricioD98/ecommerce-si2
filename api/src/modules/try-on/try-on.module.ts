import { Module } from '@nestjs/common';
import { TryOnController } from './try-on.controller';
import { TryOnService } from './try-on.service';

// TenantSecretsService viene de TenancyModule (@Global)
@Module({
  controllers: [TryOnController],
  providers: [TryOnService],
})
export class TryOnModule {}
