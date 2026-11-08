import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class RestoreBackupDto {
  @ApiProperty({ description: 'Slug de la tienda (restauración de tienda) o RESTORE-PLATFORM (plataforma)' })
  @IsString()
  @MaxLength(200)
  confirmation!: string;

  @ApiProperty({ description: 'Confirma que los datos actuales incluidos en la copia serán reemplazados' })
  @IsBoolean()
  acknowledgeReplace!: boolean;
}

export class PlatformBackupListQueryDto {
  @ApiPropertyOptional({ enum: ['TENANT', 'PLATFORM'] })
  @IsOptional()
  @IsIn(['TENANT', 'PLATFORM'])
  scope?: 'TENANT' | 'PLATFORM';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  tenantId?: string;
}
