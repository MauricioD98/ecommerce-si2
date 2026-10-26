import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

export const PLATFORM_KEY_HEADER = 'x-platform-key';

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Protege el plano de control (alta de tiendas, reintentos). No usa el JWT de las tiendas: un
 * Super Admin de una tienda NO es administrador de la plataforma. Se autentica con una llave de
 * plataforma (PLATFORM_ADMIN_KEY, ≥32 caracteres) en el header x-platform-key.
 * Sin la variable configurada falla cerrado: nadie entra.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  private readonly logger = new Logger(PlatformAdminGuard.name);
  private readonly expected = process.env.PLATFORM_ADMIN_KEY;

  constructor() {
    if (!this.expected || this.expected.length < 32) {
      this.logger.warn('PLATFORM_ADMIN_KEY ausente o corta (<32): los endpoints de plataforma quedan bloqueados');
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const provided = context.switchToHttp().getRequest<Request>().header(PLATFORM_KEY_HEADER);
    if (!this.expected || this.expected.length < 32 || !provided) {
      throw new UnauthorizedException('Credenciales de plataforma requeridas');
    }
    // Comparación en tiempo constante sobre digests del mismo largo
    if (!timingSafeEqual(digest(provided), digest(this.expected))) {
      throw new UnauthorizedException('Credenciales de plataforma inválidas');
    }
    return true;
  }
}
