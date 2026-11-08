import { Type } from 'class-transformer';
import { IsEmail, IsIn, IsISO8601, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { AUDIT_ACTIONS } from './platform-audit.service';

export class AuditQueryDto {
  @IsOptional()
  @IsIn(AUDIT_ACTIONS as unknown as string[])
  action?: string;

  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @IsOptional()
  @IsEmail()
  actorEmail?: string;

  @IsOptional()
  @IsIn(['SUCCESS', 'FAILURE', 'REQUESTED'])
  result?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  // Paginación: created_at del último registro de la página anterior
  @IsOptional()
  @IsISO8601()
  before?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
