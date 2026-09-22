import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayUnique, IsArray, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ALL_PERMISSIONS } from '../../../common/constants/permissions';

export class CreateRoleDto {
  @ApiProperty({ example: 'Supervisor de turno', description: 'Nombre único del rol', maxLength: 50 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name: string;

  @ApiPropertyOptional({ example: 'Supervisa pedidos e inventario', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @ApiProperty({
    description: 'Permisos del rol',
    enum: ALL_PERMISSIONS,
    isArray: true,
    example: ['MANAGE_INVENTORY', 'VIEW_ORDERS'],
  })
  @IsArray()
  @ArrayUnique()
  @IsIn(ALL_PERMISSIONS, { each: true, message: 'Cada permiso debe ser uno de: ' + ALL_PERMISSIONS.join(', ') })
  permissions: string[];
}
