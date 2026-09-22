import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateBranchDto {
  @ApiProperty({
    example: 'Sucursal Centro',
    description: 'Nombre de la sucursal',
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    example: 'Calle Libertad #245, Santa Cruz de la Sierra',
    description: 'Dirección de la sucursal',
    required: false,
    maxLength: 255,
  })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  address?: string;

  @ApiProperty({
    example: '+591 3 3345678',
    description: 'Teléfono de contacto',
    required: false,
    maxLength: 30,
  })
  @IsString()
  @IsOptional()
  @MaxLength(30)
  phone?: string;

  @ApiProperty({
    example: true,
    description: 'Indica si la sucursal está activa',
    required: false,
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
