import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class QueryChatbotProductsDto {
  @ApiPropertyOptional({
    description: 'Texto libre para buscar en el nombre y la descripción del producto',
    example: 'vestido negro',
  })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({
    description:
      'Sucursal desde la que consulta el cliente. Con este valor el stock y el precio con descuento ' +
      'son los de esa sucursal; sin él, el stock se suma entre todas y el precio es el base.',
  })
  @IsUUID()
  @IsOptional()
  branchId?: string;

  @ApiPropertyOptional({
    description: 'Devuelve solo productos con al menos una talla en stock',
    example: true,
  })
  // Se lee el valor crudo de la query (`obj[key]`) y no `value`: el ValidationPipe global corre con
  // enableImplicitConversion, que ya aplicó Boolean() al string, y Boolean('false') es true. Mismo
  // patrón que QueryProductDto.isActive.
  @Transform(({ obj, key }) => {
    const raw = (obj as Record<string, unknown>)[key];
    if (raw === 'true' || raw === true) return true;
    if (raw === 'false' || raw === false) return false;
    return undefined;
  })
  @IsBoolean()
  @IsOptional()
  inStockOnly?: boolean;

  @ApiPropertyOptional({
    description: 'Máximo de productos a devolver (1-50). Por defecto 20.',
    example: 20,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  @IsOptional()
  limit?: number;
}
