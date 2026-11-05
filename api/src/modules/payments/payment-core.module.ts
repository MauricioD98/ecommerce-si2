import { Module } from '@nestjs/common';
import { BranchesModule } from '../branches/branches.module';
import { PaymentSettlementService } from './payment-settlement.service';
import { StripeGateway } from './stripe-gateway.service';

// Lo comparten Orders (cancelación) y Payments (cobro): evita el ciclo entre ambos módulos
@Module({
  imports: [BranchesModule],
  providers: [StripeGateway, PaymentSettlementService],
  exports: [StripeGateway, PaymentSettlementService],
})
export class PaymentCoreModule {}
