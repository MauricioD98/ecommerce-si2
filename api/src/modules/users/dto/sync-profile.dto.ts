import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsDefined, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested } from 'class-validator';

// Mismas reglas que UpdateUserDto: texto recortado y "" → null
const trimOrNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

// Los valores esperados se normalizan igual que los nuevos: si no, " Ana" nunca coincidiría con "Ana"
const trimEachOrNull = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? value.map((item) => trimOrNull({ value: item })) : value;

/**
 * Campos del perfil que la PWA puede editar sin conexión. Deliberadamente NO incluye el correo (la
 * pantalla de perfil no permite cambiarlo) ni la contraseña (exige la actual en línea).
 */
export const OFFLINE_PROFILE_FIELDS = ['firstName', 'lastName', 'phone', 'preferredBranchId'] as const;
export type OfflineProfileField = (typeof OFFLINE_PROFILE_FIELDS)[number];

export class ProfileChangesDto {
  @ApiProperty({ required: false, maxLength: 60 })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(60)
  firstName?: string;

  @ApiProperty({ required: false, maxLength: 60, nullable: true })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(60)
  lastName?: string | null;

  @ApiProperty({ required: false, nullable: true, example: '+591 70000000' })
  @IsOptional()
  @Transform(trimOrNull)
  @Matches(/^\+?[\d\s-]{7,20}$/, { message: 'El teléfono debe tener entre 7 y 20 dígitos (puede llevar +, espacios o guiones)' })
  phone?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsUUID('all', { message: 'La sucursal favorita no es válida' })
  preferredBranchId?: string | null;
}

// Para cada campo cambiado, los valores que el cliente acepta encontrar en el servidor: el que leyó
// antes de editar y los que ya envió en intentos anteriores de este mismo cambio.
export class ProfileExpectedDto {
  @IsOptional() @IsArray() @Transform(trimEachOrNull) firstName?: (string | null)[];
  @IsOptional() @IsArray() @Transform(trimEachOrNull) lastName?: (string | null)[];
  @IsOptional() @IsArray() @Transform(trimEachOrNull) phone?: (string | null)[];
  @IsOptional() @IsArray() preferredBranchId?: (string | null)[];
}

export class SyncProfileDto {
  @ApiProperty({ description: 'Id del cambio generado en el dispositivo; un reintento reusa el mismo' })
  @IsUUID('all')
  changeId: string;

  @ApiProperty({ type: ProfileChangesDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => ProfileChangesDto)
  changes: ProfileChangesDto;

  @ApiProperty({ type: ProfileExpectedDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => ProfileExpectedDto)
  expected: ProfileExpectedDto;
}
