import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, Matches } from 'class-validator';

export class VerifyOtpDto {
  @ApiProperty({ description: 'Correo de la cuenta', example: 'john.doe@example.com' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail({}, { message: 'Por favor ingrese un correo electrónico válido' })
  @IsNotEmpty({ message: 'El correo electrónico es obligatorio' })
  email: string;

  @ApiProperty({ description: 'Código de 6 dígitos recibido por correo', example: '001234' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'El código debe ser texto de 6 dígitos' })
  @Matches(/^\d{6}$/, { message: 'El código debe tener 6 dígitos' })
  otp: string;
}
