import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ItemCondition, ReturnReason } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ProcessReturnItemDto {
  @ApiProperty({
    description:
      'Línea de la orden original que se devuelve. Se apunta al OrderItem (no al producto) porque es ' +
      'lo que fija el tope: no se puede devolver más de lo que esa línea vendió.',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  orderItemId: string;

  @ApiProperty({ description: 'Unidades a devolver de esa línea', example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiProperty({ description: 'Motivo declarado por el cliente', enum: ReturnReason, example: ReturnReason.WRONG_SIZE })
  @IsEnum(ReturnReason)
  reason: ReturnReason;

  @ApiProperty({
    description:
      'Estado físico de la prenda. SELLABLE vuelve al stock vendible de la sucursal; DAMAGED entra a ' +
      'mermas (damagedStock) y no se puede volver a vender.',
    enum: ItemCondition,
    example: ItemCondition.SELLABLE,
  })
  @IsEnum(ItemCondition)
  condition: ItemCondition;
}

export class ProcessReturnDto {
  @ApiProperty({ description: 'Orden (venta web o de caja) contra la que se devuelve' })
  @IsUUID()
  orderId: string;

  @ApiProperty({
    description:
      'Ítems a devolver. Se puede repetir el mismo orderItemId con distinta `condition` para partir ' +
      'una devolución (ej. de 2 unidades, 1 vuelve vendible y 1 entra a mermas).',
    type: [ProcessReturnItemDto],
  })
  @IsArray()
  @ArrayNotEmpty({ message: 'Debe enviar al menos un ítem a devolver' })
  @ValidateNested({ each: true })
  @Type(() => ProcessReturnItemDto)
  items: ProcessReturnItemDto[];

  @ApiPropertyOptional({
    description:
      'Sucursal que RECIBE la mercadería. Solo tiene efecto con el permiso ALL_BRANCHES; el resto del ' +
      'personal siempre devuelve contra su propia sucursal.',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'Observaciones del cajero', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
