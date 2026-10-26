import { Module } from '@nestjs/common';
import { StoreController } from './store.controller';

// ControlPrismaService viene de TenancyModule (@Global)
@Module({
  controllers: [StoreController],
})
export class StoreModule {}
