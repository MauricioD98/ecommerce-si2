
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsPositive } from 'class-validator';

export class UpdateCartItemDto {
  @ApiProperty({
    description: 'Nueva cantidad para el producto',
    example: 3,
    minimum: 1,
  })
  @IsInt()
  @IsPositive()
  quantity: number;
}