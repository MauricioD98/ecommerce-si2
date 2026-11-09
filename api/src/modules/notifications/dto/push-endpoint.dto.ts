import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

// Identifica la suscripción del navegador actual (su endpoint) para consultarla, desvincularla o probarla
export class PushEndpointDto {
  @ApiProperty({ description: 'Endpoint de la suscripción push del navegador actual' })
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  endpoint: string;
}

export class PushTestDto extends PushEndpointDto {
  @ApiPropertyOptional({ description: 'Título ya traducido al idioma del usuario' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  title?: string;

  @ApiPropertyOptional({ description: 'Texto ya traducido al idioma del usuario' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  body?: string;
}
