import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, Matches, ValidateIf } from 'class-validator';

export class SetTenantDomainDto {
  // null quita el dominio propio (la tienda vuelve a usarse solo con ?tenant= / selector)
  @ApiProperty({ example: 'boutiquemia.com', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(/^(?!www\.)(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, {
    message: 'dominio inválido: minúsculas, sin protocolo, sin puerto y sin "www." (ej. boutiquemia.com)',
  })
  domain: string | null;
}
