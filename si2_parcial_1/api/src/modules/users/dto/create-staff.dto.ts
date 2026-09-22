import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEmail, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, Min, MinLength } from 'class-validator';

export class CreateStaffDto {
  @ApiProperty({ description: 'Email del empleado', example: 'empleado@stellafemme.com' })
  @IsEmail({}, { message: 'Por favor ingrese un correo electrónico válido' })
  @IsNotEmpty({ message: 'El correo electrónico es obligatorio' })
  email: string;

  @ApiProperty({ description: 'Contraseña inicial', example: 'StrongP@ssw0rd!' })
  @IsString()
  @IsNotEmpty({ message: 'La contraseña es obligatoria' })
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/, {
    message: 'La contraseña debe contener al menos una letra mayúscula, una letra minúscula, un número y un carácter especial',
  })
  password: string;

  @ApiPropertyOptional({ example: 'Maria' })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Perez' })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiProperty({
    description: 'ID del rol. Solo se pueden asignar roles que no den más permisos de los que tiene quien los asigna (ver GET /roles/assignable)',
  })
  @IsUUID()
  roleId: string;

  @ApiPropertyOptional({
    description: 'Sucursal asignada. Obligatoria para quien tiene alcance global; con alcance de sucursal se asigna la propia',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({
    description: 'Porcentaje de descuento de trabajador (0-100)',
    example: 15,
    minimum: 0,
    maximum: 100,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  employeeDiscount?: number;
}
