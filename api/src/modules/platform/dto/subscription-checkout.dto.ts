import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { PLAN_KEYS, type PlanKey } from '../plans';
import { i18nMessage } from '../../../i18n/i18n-message';

const trimLower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class SubscriptionCheckoutDto {
  @ApiProperty({ enum: PLAN_KEYS })
  @IsIn(PLAN_KEYS, { message: i18nMessage('validation.PLAN_INVALID', { plans: PLAN_KEYS.join(', ') }) })
  plan: PlanKey;

  @ApiProperty({ example: 'Boutique Aurora' })
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  tenantName: string;

  // Opcional: muchas tiendas arrancan sin dominio propio y usan el enlace de la plataforma.
  // Se acepta "www.x.com" o "https://x.com/" y se normaliza a "x.com".
  @ApiPropertyOptional({ example: 'boutiquemia.com' })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '') || undefined
      : value,
  )
  @Matches(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, {
    message: i18nMessage('validation.DOMAIN_INVALID'),
  })
  domain?: string;

  @ApiProperty({ example: 'duena@aurora.com' })
  @Transform(trimLower)
  @IsEmail()
  @MaxLength(254)
  adminEmail: string;

  // Es la cuenta Super Admin de la tienda: mínimo 8, con letras y números
  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(72) // bcrypt ignora lo que pasa de 72 bytes
  @Matches(/(?=.*[A-Za-z])(?=.*\d)/, { message: i18nMessage('validation.PASSWORD_LETTERS_NUMBERS') })
  adminPassword: string;
}
