import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

// La tienda se elige ANTES de autenticar (dominio propio, tienda activa o selector): el login nunca
// busca el correo en otras tiendas
export class TenantLoginDto {
  @ApiProperty({ example: 'usuario@ejemplo.com' })
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: 'StrongP@ssw0rd!' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password: string;

  @ApiProperty({ description: 'UUID de la tienda elegida. Es la única donde se consultan las credenciales' })
  @IsUUID()
  tenantId: string;
}
