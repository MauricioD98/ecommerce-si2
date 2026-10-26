import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

// Solo ACTIVE ⇄ SUSPENDED: PROVISIONING y FAILED los maneja el aprovisionamiento (ver retry)
export const SETTABLE_TENANT_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export type SettableTenantStatus = (typeof SETTABLE_TENANT_STATUSES)[number];

export class SetTenantStatusDto {
  @ApiProperty({ enum: SETTABLE_TENANT_STATUSES })
  @IsIn(SETTABLE_TENANT_STATUSES)
  status: SettableTenantStatus;
}
