import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class UpdateStaffDto {
  @ApiPropertyOptional({ description: 'Nuevo rol (solo uno que quien edita pueda asignar)' })
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @ApiPropertyOptional({ description: 'Nueva sucursal (con alcance de sucursal no se puede mover a otra)' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'Porcentaje de descuento de trabajador (0-100)', minimum: 0, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  employeeDiscount?: number;
}
