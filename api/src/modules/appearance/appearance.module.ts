import { Module } from '@nestjs/common';
import { PublicStoreAppearanceController, StoreAppearanceController } from './store-appearance.controller';
import { StoreAppearanceService } from './store-appearance.service';

// PrismaModule es @Global, así que no hace falta importarlo acá
@Module({
  controllers: [StoreAppearanceController, PublicStoreAppearanceController],
  providers: [StoreAppearanceService],
})
export class AppearanceModule {}
