import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { CategoryModule } from '../category/category.module';
import { CollectionsModule } from '../collections/collections.module';
import { OrdersModule } from '../orders/orders.module';
import { OfflineSyncController } from './offline-sync.controller';
import { OfflineSyncService } from './offline-sync.service';

@Module({
  imports: [ProductsModule, CategoryModule, CollectionsModule, OrdersModule],
  controllers: [OfflineSyncController],
  providers: [OfflineSyncService],
})
export class OfflineSyncModule {}
