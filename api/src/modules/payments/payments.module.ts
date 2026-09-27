import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { PaymentsController } from './payments.controller';
import { PaymentsWebhookController } from './payments.webhook.controller';
import { PaymentsService } from './payments.service';
import { InvoicesModule } from '../invoices/invoices.module';
import { BranchesModule } from '../branches/branches.module';

@Module({
  imports: [
    InvoicesModule,
    BranchesModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
  ],
  controllers: [PaymentsController, PaymentsWebhookController],
  providers: [PaymentsService]
})
export class PaymentsModule {}
