import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, IsUUID, Max, Min, ValidateNested } from 'class-validator';
import { MAX_LINE_QUANTITY } from '../../../common/checkout/checkout-policy';

class SyncCartItemDto {
  @ApiProperty()
  @IsUUID()
  productId: string;

  @ApiProperty({ minimum: 1, maximum: MAX_LINE_QUANTITY })
  @IsInt()
  @IsPositive()
  @Max(MAX_LINE_QUANTITY)
  quantity: number;

  @ApiProperty({ example: 'M' })
  @IsString()
  @IsNotEmpty()
  size: string;
}

// Reemplazo atómico del carrito del servidor por el carrito local (el web lo guarda en el navegador)
export class SyncCartDto {
  @ApiProperty({ type: [SyncCartItemDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SyncCartItemDto)
  items: SyncCartItemDto[];

  @ApiPropertyOptional({ description: 'Sucursal contra la que se reserva' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'Revisión leída; si cambió, 409 CART_VERSION_CONFLICT' })
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}
