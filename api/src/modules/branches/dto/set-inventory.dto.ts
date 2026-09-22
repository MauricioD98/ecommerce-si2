import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';
import { DiscountDto } from './discount.dto';

export class SetInventoryDto extends DiscountDto {
  @ApiProperty({
    description: 'Stock absoluto del producto en la sucursal',
    example: 25,
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  stock: number;
}
