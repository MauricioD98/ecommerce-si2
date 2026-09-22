import { Module } from '@nestjs/common';
import { InvoiceService } from './invoice.service';

// Genera facturas en PDF. Lo usan los pagos en línea y lo usará el futuro módulo de venta presencial (POS)
@Module({
  providers: [InvoiceService],
  exports: [InvoiceService],
})
export class InvoicesModule {}
