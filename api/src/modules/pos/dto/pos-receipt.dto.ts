import { ApiProperty } from '@nestjs/swagger';

export class PosReceiptItemDto {
  @ApiProperty()
  productName: string;

  @ApiProperty()
  size: string;

  @ApiProperty()
  quantity: number;

  @ApiProperty()
  unitPrice: number;

  @ApiProperty()
  subtotal: number;
}

// Todo lo que necesita el ticket/recibo impreso de una venta de caja
export class PosReceiptDto {
  @ApiProperty()
  orderId: string;

  @ApiProperty()
  orderNumber: string;

  @ApiProperty({ type: [PosReceiptItemDto] })
  items: PosReceiptItemDto[];

  @ApiProperty()
  subtotal: number;

  @ApiProperty()
  discountApplied: number;

  @ApiProperty()
  total: number;

  @ApiProperty({ enum: ['CASH', 'PHYSICAL_CARD', 'QR'] })
  paymentMethod: string;

  @ApiProperty()
  branchName: string;

  @ApiProperty()
  cashierName: string;

  @ApiProperty()
  customerName: string;

  @ApiProperty({ nullable: true, description: 'NIT o CI para la factura' })
  nit: string | null;

  @ApiProperty({ nullable: true, description: 'Nombre o razón social para la factura' })
  razonSocial: string | null;

  @ApiProperty({ nullable: true, description: 'Monto en efectivo recibido (solo CASH)' })
  amountReceived: number | null;

  @ApiProperty({ nullable: true, description: 'Cambio a entregar: amountReceived - total (solo CASH)' })
  change: number | null;

  @ApiProperty()
  createdAt: Date;
}

export class PosCheckoutResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty({ type: PosReceiptDto })
  data: PosReceiptDto;

  @ApiProperty({ required: false })
  message?: string;
}
