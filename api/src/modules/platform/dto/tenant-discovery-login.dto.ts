import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class TenantDiscoveryLoginDto {
  @ApiProperty({ example: 'usuario@ejemplo.com' })
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: 'StrongP@ssw0rd!' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password: string;

  @ApiPropertyOptional({ description: 'UUID explícito de la tienda a la que desea ingresar (opcional)' })
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @ApiPropertyOptional({ description: 'UUID de la tienda actualmente activa en el navegador, para priorizarla si hay múltiples coincidencias' })
  @IsOptional()
  @IsUUID()
  preferredTenantId?: string;
}

