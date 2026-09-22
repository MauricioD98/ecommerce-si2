import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateAddressDto {
  @ApiProperty({ example: 'Casa', description: 'Nombre corto de la dirección', maxLength: 50 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  title: string;

  @ApiProperty({ example: 'Av. San Martín #1050', description: 'Calle y número', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  address: string;

  @ApiPropertyOptional({ example: 'Casa blanca con portón negro, frente al parque', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reference?: string;

  @ApiProperty({ example: -17.7833, description: 'Latitud del punto elegido en el mapa', minimum: -90, maximum: 90 })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @ApiProperty({ example: -63.1821, description: 'Longitud del punto elegido en el mapa', minimum: -180, maximum: 180 })
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @ApiPropertyOptional({ example: false, description: 'Usar como dirección predeterminada (la primera dirección lo es siempre)' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
