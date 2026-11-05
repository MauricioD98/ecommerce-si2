import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PLAN_FEATURE_KEY } from '../plan-feature.decorator';
import { assertPlanFeature, type PlanBooleanFeature } from '../../../modules/platform/plans';

@Injectable()
export class PlanFeatureGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredFeature = this.reflector.getAllAndOverride<PlanBooleanFeature | undefined>(
      PLAN_FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredFeature) return true;
    assertPlanFeature(requiredFeature);
    return true;
  }
}

