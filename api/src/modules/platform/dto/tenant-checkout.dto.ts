import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { BILLING_INTERVALS, PLAN_KEYS, type BillingInterval, type PlanKey } from '../plans';
import { i18nMessage } from '../../../i18n/i18n-message';

// Solo la clave del plan: el price_id lo pone el backend (plans.ts) y la tienda sale del JWT
export class TenantCheckoutDto {
  @ApiProperty({ enum: PLAN_KEYS })
  @IsIn(PLAN_KEYS, { message: i18nMessage('validation.PLAN_INVALID', { plans: PLAN_KEYS.join(', ') }) })
  plan: PlanKey;

  // Mensual (por defecto) o anual. El price_id correspondiente lo elige el backend
  @ApiPropertyOptional({ enum: BILLING_INTERVALS, default: 'monthly' })
  @IsOptional()
  @IsIn(BILLING_INTERVALS, {
    message: i18nMessage('validation.BILLING_INTERVAL_INVALID', { intervals: BILLING_INTERVALS.join(', ') }),
  })
  interval?: BillingInterval;
}
