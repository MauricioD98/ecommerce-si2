import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { i18nMessage } from '../../../i18n/i18n-message';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ContactDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  name: string;

  @ApiProperty()
  @Transform(trim)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(10, 5000, { message: i18nMessage('validation.CONTACT_MESSAGE_LENGTH') })
  message: string;

  // Honeypot: campo oculto en el formulario. Una persona no lo ve ni lo completa; un bot que llena
  // todos los inputs sí. Si viene con algo, se responde OK sin enviar nada.
  @ApiPropertyOptional({ description: 'Debe quedar vacío' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}
