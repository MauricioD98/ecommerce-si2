import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class SetDecartIntegrationDto {
  @ApiProperty({ description: 'API key permanente de Decart (dct_...) de la tienda' })
  @IsString()
  @Matches(/^dct_/, { message: 'la API key de Decart empieza con "dct_"' })
  @MaxLength(500)
  apiKey: string;
}

// Importar un par VAPID existente (si la tienda ya tenía clientes suscritos con él)
export class SetWebPushIntegrationDto {
  @ApiProperty()
  @IsString()
  @MinLength(80)
  @MaxLength(100)
  publicKey: string;

  @ApiProperty()
  @IsString()
  @MinLength(40)
  @MaxLength(50)
  privateKey: string;

  @ApiProperty({ example: 'mailto:soporte@boutiquemia.com' })
  @Matches(/^(mailto:|https:\/\/)/, { message: 'subject debe ser mailto:… o https://…' })
  subject: string;
}

export class GenerateWebPushDto {
  @ApiPropertyOptional({ example: 'mailto:soporte@boutiquemia.com' })
  @IsOptional()
  @Matches(/^(mailto:|https:\/\/)/, { message: 'subject debe ser mailto:… o https://…' })
  subject?: string;
}
