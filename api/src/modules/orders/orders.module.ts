import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

import { BranchesModule } from '../branches/branches.module';
import { PaymentCoreModule } from '../payments/payment-core.module';

@Module({
  imports: [BranchesModule, PaymentCoreModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  // PaymentsModule lo usa para cancelar (y reponer stock) al rechazar un comprobante
  exports: [OrdersService],
})
export class OrdersModule {}
