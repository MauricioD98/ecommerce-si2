import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

// GET /returns/search-order: busca la venta original por código, NIT, razón social o datos del cliente
export class SearchOrderDto {
  @ApiPropertyOptional({
    description: 'Número de orden, ID, NIT, razón social, email o nombre del cliente',
    example: 'ckv8v1f2p0000',
  })
  @IsString()
  @IsNotEmpty({ message: 'Escribe un código de ticket, NIT o cliente para buscar' })
  @MaxLength(120)
  query: string;

  @ApiPropertyOptional({ description: 'Solo tiene efecto con el permiso ALL_BRANCHES' })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

// GET /returns: historial de devoluciones (auditoría de mermas y reingresos)
export class QueryReturnsDto {
  @ApiPropertyOptional({ description: 'Filtra las devoluciones que incluyen este producto' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ description: 'Solo tiene efecto con el permiso ALL_BRANCHES' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
