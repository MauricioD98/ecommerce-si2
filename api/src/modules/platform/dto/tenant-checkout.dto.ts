import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { PLAN_KEYS, type PlanKey } from '../plans';
import { i18nMessage } from '../../../i18n/i18n-message';

// Solo la clave del plan: el price_id lo pone el backend (plans.ts) y la tienda sale del JWT
export class TenantCheckoutDto {
  @ApiProperty({ enum: PLAN_KEYS })
  @IsIn(PLAN_KEYS, { message: i18nMessage('validation.PLAN_INVALID', { plans: PLAN_KEYS.join(', ') }) })
  plan: PlanKey;
}
