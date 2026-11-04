
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsPositive, IsUUID, Max, Min } from 'class-validator';
import { MAX_LINE_QUANTITY } from '../../../common/checkout/checkout-policy';

export class UpdateCartItemDto {
  @ApiProperty({
    description: 'Nueva cantidad para el producto',
    example: 3,
    minimum: 1,
  })
  @IsInt()
  @IsPositive()
  @Max(MAX_LINE_QUANTITY)
  quantity: number;

  @ApiPropertyOptional({
    description: 'Sucursal de la reserva. Si difiere de la actual, la reserva se mueve en una transacción o falla entera',
    example: 'b1c2d3e4-f5a6-7890-1234-56789abcdef0',
  })
  @IsUUID()
  @IsOptional()
  branchId?: string;

  @ApiPropertyOptional({ description: 'Revisión del carrito leída; si cambió, 409 CART_VERSION_CONFLICT' })
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}
