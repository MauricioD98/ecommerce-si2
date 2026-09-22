import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsEnum, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Max, Min, ValidateNested } from 'class-validator';
import { FulfillmentType } from '@prisma/client';

class OrderItemDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  productId: string;

  @ApiProperty()
  @IsInt()
  @IsPositive()
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

  @ApiProperty({ type: [OrderItemDto] })
  @IsArray()
  @ArrayNotEmpty()
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
    enum: ['QR'],
    description:
      'Solo para checkout sin Stripe (ej. pedido guardado offline y sincronizado luego). Omitido, el pedido usa STRIPE (default). paymentStatus siempre queda PENDIENTE: el pago manual lo confirma el staff.',
  })
  @IsOptional()
  @IsIn(['QR'])
  paymentMethod?: 'QR';
}
