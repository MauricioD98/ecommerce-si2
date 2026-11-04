import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayNotEmpty, ArrayUnique, IsArray, IsInt, IsNotEmpty, IsString, IsUUID, Min, ValidateNested } from 'class-validator';
import { DiscountDto } from './discount.dto';

class SizeStockDto {
  @ApiProperty({ description: 'Talla (debe ser una de las que tiene el producto)', example: 'M' })
  @IsString()
  @IsNotEmpty()
  size: string;

  @ApiProperty({ description: 'Stock absoluto de esa talla en la sucursal', example: 10, minimum: 0 })
  @IsInt()
  @Min(0)
  stock: number;

  @ApiProperty({ description: 'Versión de la fila que se leyó (0 si la fila no existía). Si cambió, la API responde 409 INVENTORY_VERSION_CONFLICT', example: 3, minimum: 0 })
  @IsInt()
  @Min(0)
  expectedVersion: number;
}

// El stock ahora es por talla; el descuento sigue siendo uno solo por producto+sucursal (se aplica
// a todas las tallas por igual, ver InventoryService.setStock)
export class SetInventoryDto extends DiscountDto {
  @ApiProperty({ description: 'Identificador único de esta operación (UUID): reenviarla no la aplica dos veces' })
  @IsUUID()
  operationId: string;

  @ApiProperty({
    description: 'Stock por talla del producto en la sucursal (una fila por cada talla que tiene el producto)',
    type: [SizeStockDto],
  })
  @IsArray()
  @ArrayNotEmpty({ message: 'Debe enviar el stock de al menos una talla' })
  @ArrayUnique((item: SizeStockDto) => item.size, { message: 'No puede repetirse la misma talla' })
  @ValidateNested({ each: true })
  @Type(() => SizeStockDto)
  sizes: SizeStockDto[];
}
