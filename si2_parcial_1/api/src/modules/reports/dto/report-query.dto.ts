import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ReportQueryDto {
  @ApiPropertyOptional({
    description: 'Sucursal. Con alcance global filtra por esa sucursal (sin valor: todas); con alcance de sucursal se usa siempre la propia',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ example: '2026-09-01', description: 'Inicio del rango (por defecto, hace 30 días)' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'Fin del rango (por defecto, hoy)' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class TopProductsQueryDto extends ReportQueryDto {
  @ApiPropertyOptional({ example: 10, minimum: 1, maximum: 50, default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
