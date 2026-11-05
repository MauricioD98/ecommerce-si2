import { SetMetadata } from '@nestjs/common';
import type { PlanBooleanFeature } from '../../modules/platform/plans';

export const PLAN_FEATURE_KEY = 'required_plan_feature';

export const RequirePlanFeature = (feature: PlanBooleanFeature) =>
  SetMetadata(PLAN_FEATURE_KEY, feature);

