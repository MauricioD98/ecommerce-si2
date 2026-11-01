import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { PlatformAdminProfile, PlatformAuthService } from '../platform-auth.service';

export const PLATFORM_KEY_HEADER = 'x-platform-key';

const digest = (value: string) => createHash('sha256').update(value).digest();

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      // Lo setea PlatformAdminGuard cuando entra un administrador con su sesión (no con la llave)
      platformAdmin?: PlatformAdminProfile;
    }
  }
}

/**
 * Protege el plano de control (alta de tiendas, reintentos). No usa el JWT de las tiendas: un
 * Super Admin de una tienda NO es administrador de la plataforma. Acepta dos credenciales:
 *  1. Authorization: Bearer <token de POST /platform/auth/login> → administradores con email y
 *     contraseña (public.platform_admins). Es lo que usa el panel /plataforma.
 *  2. x-platform-key: PLATFORM_ADMIN_KEY (≥32 caracteres) → scripts y automatizaciones. Sin la
 *     variable configurada esta vía queda cerrada.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  private readonly expectedKey = process.env.PLATFORM_ADMIN_KEY;

  constructor(private readonly auth: PlatformAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    const bearer = req.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (bearer) {
      const admin = await this.auth.verify(bearer);
      if (!admin) throw new UnauthorizedException('Sesión de plataforma inválida o vencida');
      req.platformAdmin = admin;
      return true;
    }

    const provided = req.header(PLATFORM_KEY_HEADER);
    if (!this.expectedKey || this.expectedKey.length < 32 || !provided) {
      throw new UnauthorizedException('Credenciales de plataforma requeridas');
    }
    // Comparación en tiempo constante sobre digests del mismo largo
    if (!timingSafeEqual(digest(provided), digest(this.expectedKey))) {
      throw new UnauthorizedException('Credenciales de plataforma inválidas');
    }
    return true;
  }
}
