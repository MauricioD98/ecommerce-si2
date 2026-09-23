import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsLatitude, IsLongitude, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

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
    example: -17.7833,
    description: 'Latitud de la ubicación exacta (elegida en el mapa)',
    required: false,
  })
  @IsLatitude()
  @IsOptional()
  latitude?: number;

  @ApiProperty({
    example: -63.1821,
    description: 'Longitud de la ubicación exacta (elegida en el mapa)',
    required: false,
  })
  @IsLongitude()
  @IsOptional()
  longitude?: number;

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
