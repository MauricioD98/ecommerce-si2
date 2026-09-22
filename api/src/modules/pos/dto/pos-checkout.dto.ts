import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Min, ValidateNested } from 'class-validator';

class PosCheckoutItemDto {
  @ApiProperty()
  @IsUUID()
  @IsNotEmpty()
  productId: string;

  @ApiProperty()
  @IsInt()
  @IsPositive()
  quantity: number;

  @ApiProperty({ example: 'M', description: 'Talla vendida: el stock se descuenta por talla' })
  @IsString()
  @IsNotEmpty()
  size: string;
}

// Métodos de pago que se cobran físicamente en caja (Stripe queda solo para el checkout web)
export const POS_PAYMENT_METHODS = ['CASH', 'PHYSICAL_CARD', 'QR'] as const;
export type PosPaymentMethod = (typeof POS_PAYMENT_METHODS)[number];

export class PosCheckoutDto {
  @ApiProperty({ type: [PosCheckoutItemDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => PosCheckoutItemDto)
  items: PosCheckoutItemDto[];

  @ApiProperty({ enum: POS_PAYMENT_METHODS })
  @IsIn(POS_PAYMENT_METHODS)
  paymentMethod: PosPaymentMethod;

  @ApiPropertyOptional({
    description: 'Monto en efectivo recibido del cliente (solo CASH). El servidor calcula y valida el cambio',
    example: 200,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  amountReceived?: number;

  @ApiPropertyOptional({
    description: 'Cliente registrado (si no se indica, la venta queda a nombre de "Consumidor Final")',
  })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({
    description: 'Sucursal donde se cobra. Por defecto, la sucursal del cajero autenticado',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'NIT o CI para la factura' })
  @IsOptional()
  @IsString()
  nit?: string;

  @ApiPropertyOptional({ description: 'Nombre o razón social para la factura' })
  @IsOptional()
  @IsString()
  razonSocial?: string;

  @ApiPropertyOptional({ description: 'Nota interna de la venta (ej. referencia del voucher físico)' })
  @IsOptional()
  @IsString()
  notes?: string;
}
