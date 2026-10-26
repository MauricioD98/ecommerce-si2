import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateTenantDto {
  @ApiProperty({ example: 'Boutique Aurora' })
  @IsString()
  @Length(2, 80)
  name: string;

  // Mismo patrón que valida TenantMiddleware para subdominios: aurora.tuapp.com
  @ApiProperty({ example: 'boutique-aurora', description: 'Subdominio: minúsculas, números y guiones' })
  @Matches(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, {
    message: 'slug inválido: solo minúsculas, números y guiones (sin empezar ni terminar con guion)',
  })
  slug: string;

  @ApiProperty({ example: 'duena@aurora.com' })
  @IsEmail()
  ownerEmail: string;

  // Mismas reglas mínimas que el registro de usuarios: es la cuenta Super Admin de la tienda
  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(72) // bcrypt ignora lo que pasa de 72 bytes
  ownerPassword: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  ownerFirstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  ownerLastName?: string;

  @ApiPropertyOptional({ example: 'free' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  plan?: string;
}
