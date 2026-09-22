
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsPositive, IsUUID } from 'class-validator';

export class UpdateCartItemDto {
  @ApiProperty({
    description: 'Nueva cantidad para el producto',
    example: 3,
    minimum: 1,
  })
  @IsInt()
  @IsPositive()
  quantity: number;

  @ApiPropertyOptional({
    description: 'Sucursal contra cuyo inventario se valida el stock (sin sucursal usa el stock global)',
    example: 'b1c2d3e4-f5a6-7890-1234-56789abcdef0',
  })
  @IsUUID()
  @IsOptional()
  branchId?: string;
}
