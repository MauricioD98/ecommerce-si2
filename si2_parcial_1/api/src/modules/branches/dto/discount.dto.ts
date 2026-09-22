import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

// Descuento de un producto en una sucursal. Campo omitido = sin cambios; null = quitar el descuento
export class DiscountDto {
  @ApiPropertyOptional({
    description: 'Precio con descuento (debe ser menor al precio del producto). Tiene prioridad sobre discountPercentage',
    example: 79.99,
    minimum: 0,
    nullable: true,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  discountPrice?: number | null;

  @ApiPropertyOptional({
    description: 'Porcentaje de descuento sobre el precio (0-100)',
    example: 20,
    minimum: 0,
    maximum: 100,
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  discountPercentage?: number | null;
}
