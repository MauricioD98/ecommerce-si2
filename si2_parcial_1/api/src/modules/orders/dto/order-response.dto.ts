
import { ApiProperty } from '@nestjs/swagger';

export class OrderApiResponseDto<T> {
  @ApiProperty({
    description: 'Indicates if the request was successfull',
  })
  success: boolean;

  @ApiProperty({
    description: 'Returned data',
    type: Object,
  })
  data: T;

  @ApiProperty({
    description: 'Optional message',
    nullable: true,
    required: false,
  })
  message?: string;

}

export class OrderItemResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  productId: string;

  @ApiProperty()
  productName: string;

  @ApiProperty({ nullable: true, description: 'Talla comprada (si aplica)' })
  size: string | null;

  @ApiProperty()
  quantity: number;

  @ApiProperty()
  price: number;

  @ApiProperty()
  subtotal: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updateAt: Date;
}

export class OrderResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  status: string;

  @ApiProperty({ enum: ['PENDIENTE', 'COMPLETADO', 'FALLIDO', 'REEMBOLSADO'], description: 'Estado del pago con Stripe' })
  paymentStatus: string;

  @ApiProperty()
  total: number;

  @ApiProperty({ description: 'Costo de envío ya incluido en `total` (0 en retiro en sucursal)' })
  shippingCost: number;

  @ApiProperty()
  shippingAddress: string;

  @ApiProperty({ enum: ['DELIVERY', 'PICKUP'] })
  fulfillmentType: string;

  @ApiProperty({ nullable: true, description: 'Latitud de entrega (DELIVERY)' })
  latitude: number | null;

  @ApiProperty({ nullable: true, description: 'Longitud de entrega (DELIVERY)' })
  longitude: number | null;

  @ApiProperty({ nullable: true })
  branchId: string | null;

  @ApiProperty({ description: 'Monto de descuento de trabajador aplicado (ya restado del total)' })
  discountApplied: number;

  @ApiProperty({ enum: ['WEB', 'POS'], description: 'Canal de venta' })
  source: string;

  @ApiProperty({ enum: ['STRIPE', 'CASH', 'PHYSICAL_CARD'] })
  paymentMethod: string;

  @ApiProperty({ nullable: true, description: 'Empleado que cobró la venta en caja (solo POS)' })
  cashierId: string | null;

  @ApiProperty({ type: [OrderItemResponseDto] })
  items: OrderItemResponseDto[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updateAt: Date;

}

export class PaginatedOrderResponseDto {
  @ApiProperty({
    type: [OrderResponseDto],
  })
  data: OrderResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;
}