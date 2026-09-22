import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsPositive, IsUUID } from 'class-validator';

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
}