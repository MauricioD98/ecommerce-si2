import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

// Texto recortado; un texto vacío se guarda como null (así el usuario puede borrar el dato)
const trimOrNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

// DTO for updating user profile
export class UpdateUserDto {
  @ApiProperty({
    description: 'User email address',
    example: 'user@example.com',
    required: false,
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({
    description: 'User first name',
    example: 'John',
    required: false,
  })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(60)
  firstName?: string;

  @ApiProperty({
    description: 'User last name',
    example: 'Doe',
    required: false,
  })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(60)
  lastName?: string;

  @ApiProperty({
    description: 'Teléfono de contacto (vacío para borrarlo)',
    example: '+591 70000000',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @Transform(trimOrNull)
  @Matches(/^\+?[\d\s-]{7,20}$/, { message: 'El teléfono debe tener entre 7 y 20 dígitos (puede llevar +, espacios o guiones)' })
  phone?: string | null;

  @ApiProperty({
    description: 'Sucursal favorita para las notificaciones (null para quitarla)',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsUUID('all', { message: 'La sucursal favorita no es válida' })
  preferredBranchId?: string | null;
}
