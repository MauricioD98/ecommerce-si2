import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, IsUUID } from 'class-validator';

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
  quantity: number;

  @ApiPropertyOptional({
    description: 'Talla elegida (debe ser una de las tallas disponibles del producto)',
    example: 'M',
  })
  @IsString()
  @IsOptional()
  size?: string;

  @ApiPropertyOptional({
    description: 'Sucursal contra cuyo inventario se valida el stock (sin sucursal usa el stock global)',
    example: 'b1c2d3e4-f5a6-7890-1234-56789abcdef0',
  })
  @IsUUID()
  @IsOptional()
  branchId?: string;
}
