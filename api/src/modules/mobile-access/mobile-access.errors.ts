import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { i18nMessage } from '../../i18n/i18n-message';
import type { AttestationMethod, MobilePlatform } from './mobile-access.config';

// Sin dependencias de servicios: lo importan TenantMiddleware y JwtStrategy sin crear ciclos.
export const MOBILE_APP_NOT_IN_PLAN = 'MOBILE_APP_NOT_IN_PLAN';
export const MOBILE_ATTESTATION_REQUIRED = 'MOBILE_ATTESTATION_REQUIRED';
export const MOBILE_ATTESTATION_INVALID = 'MOBILE_ATTESTATION_INVALID';
export const MOBILE_ATTESTATION_UNAVAILABLE = 'MOBILE_ATTESTATION_UNAVAILABLE';
export const MOBILE_CHANNEL_MISMATCH = 'MOBILE_CHANNEL_MISMATCH';

/** Lo que queda en la sesión móvil: con qué se probó la app y cuándo. */
export interface MobileSessionClaims {
  platform: MobilePlatform;
  method: AttestationMethod;
  attestedAt: number; // epoch ms
}

export const mobilePlanForbidden = () =>
  new ForbiddenException({ code: MOBILE_APP_NOT_IN_PLAN, message: i18nMessage('errors.MOBILE_APP_NOT_IN_PLAN') });

export const mobileAttestationRequired = () =>
  new UnauthorizedException({ code: MOBILE_ATTESTATION_REQUIRED, message: i18nMessage('errors.MOBILE_ATTESTATION_REQUIRED') });

export const mobileChannelMismatch = () =>
  new UnauthorizedException({ code: MOBILE_CHANNEL_MISMATCH, message: i18nMessage('errors.MOBILE_CHANNEL_MISMATCH') });
