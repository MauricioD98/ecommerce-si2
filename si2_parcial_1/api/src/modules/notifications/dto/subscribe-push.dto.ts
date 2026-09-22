import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUrl, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class PushSubscriptionKeysDto {
  @ApiProperty({ description: 'Llave pública P-256DH de la suscripción del navegador' })
  @IsString()
  @IsNotEmpty()
  p256dh: string;

  @ApiProperty({ description: 'Secreto de autenticación de la suscripción del navegador' })
  @IsString()
  @IsNotEmpty()
  auth: string;
}

// Forma estándar de PushSubscription.toJSON() en el navegador
export class SubscribePushDto {
  @ApiProperty({ description: 'Endpoint único que identifica el dispositivo/navegador suscrito' })
  @IsUrl({ require_tld: false })
  endpoint: string;

  @ApiProperty({ type: PushSubscriptionKeysDto })
  @ValidateNested()
  @Type(() => PushSubscriptionKeysDto)
  keys: PushSubscriptionKeysDto;
}
