import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, IsUUID, Max, Min } from 'class-validator';
import { MAX_LINE_QUANTITY } from '../../../common/checkout/checkout-policy';

export class AddCartItemDto {
  @ApiProperty({
    description: 'ID del producto a agregar',
    example: 'a1b2c3d4-e5f6-7890-1234-56789abcdef0',
  })
  @IsUUID()
  @IsNotEmpty()
  productId: string;

  @ApiProperty({
    description: 'Cantidad de unidades a agregar',
    example: 2,
    minimum: 1,
  })
  @IsInt()
  @IsPositive()
  @Max(MAX_LINE_QUANTITY)
  quantity: number;

  @ApiPropertyOptional({
    description: 'Talla elegida (debe ser una de las tallas disponibles del producto)',
    example: 'M',
  })
  @IsString()
  @IsOptional()
  size?: string;

  @ApiPropertyOptional({
    description: 'Sucursal donde se reserva el stock (sin sucursal: la del ítem o la primera activa)',
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
