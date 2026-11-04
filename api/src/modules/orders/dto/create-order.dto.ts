import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsEnum, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Max, Min, ValidateNested } from 'class-validator';
import { MAX_LINE_QUANTITY } from '../../../common/checkout/checkout-policy';
import { FulfillmentType } from '@prisma/client';

class OrderItemDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  productId: string;

  @ApiProperty()
  @IsInt()
  @IsPositive()
  @Max(MAX_LINE_QUANTITY)
  quantity: number;

  @ApiProperty({
    example: 'M',
    description: 'Talla comprada: obligatoria, el stock ahora se descuenta por talla',
  })
  @IsNotEmpty()
  @IsString()
  size: string;

  @ApiPropertyOptional({
    example: 49.99,
    deprecated: true,
    description: 'Ignorado: el servidor calcula el precio con los descuentos vigentes',
  })
  @IsOptional()
  @IsNumber(
    {
      maxDecimalPlaces: 2,
    },
    { message: 'Price must be a valid number (e.g., 49.99)' },
  )
  @Type(()=> Number)
  price?: number;

}

export class CreateOrderDto {
  @ApiProperty({
    example: 7,
    description: 'Revisión del carrito (GET /cart → version) sobre la que el cliente confirmó. Se consume una sola vez, incluso con otra Idempotency-Key.',
  })
  @IsInt()
  @Min(1)
  cartVersion: number;

  @ApiPropertyOptional({
    example: 215.5,
    description: 'Total que el cliente vio y aceptó. Si el servidor calcula otro: 409 PRICE_CHANGED, sin efectos.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  expectedTotal?: number;

  @ApiProperty({ type: [OrderItemDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  shippingAddress?: string;

  @ApiPropertyOptional({
    example: -17.7833,
    description: 'Latitud exacta de entrega (solo DELIVERY). Debe enviarse junto con longitude',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({
    example: -63.1821,
    description: 'Longitud exacta de entrega (solo DELIVERY). Debe enviarse junto con latitude',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional({
    enum: FulfillmentType,
    default: FulfillmentType.DELIVERY,
    description: 'DELIVERY (envío) o PICKUP (retiro en sucursal)',
  })
  @IsOptional()
  @IsEnum(FulfillmentType)
  fulfillmentType?: FulfillmentType;

  @ApiPropertyOptional({
    description:
      'Sucursal de retiro o despacho. Obligatoria para PICKUP; si se indica, el stock se valida y descuenta de esa sucursal',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({
    enum: ['QR', 'BANK_QR', 'USDT'],
    description:
      'Checkout sin Stripe. QR: QR simulado (o pedido offline sincronizado). BANK_QR / USDT: medios manuales de la tienda (solo si están activos en PaymentSettings); el cliente sube luego el comprobante o el TxID. Omitido, el pedido usa STRIPE (default). paymentStatus siempre queda PENDIENTE.',
  })
  @IsOptional()
  @IsIn(['QR', 'BANK_QR', 'USDT'])
  paymentMethod?: 'QR' | 'BANK_QR' | 'USDT';
}
