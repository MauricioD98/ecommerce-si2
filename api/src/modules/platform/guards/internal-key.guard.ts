import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

export const INTERNAL_KEY_HEADER = 'x-internal-key';

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Llamadas servidor-a-servidor del front (front/proxy.ts resolviendo dominio → tienda). Va aparte
 * de PLATFORM_ADMIN_KEY: el front solo necesita resolver dominios, no crear tiendas, así que si la
 * llave del front se filtra no da acceso al alta de tiendas. Sin INTERNAL_API_KEY falla cerrado.
 */
@Injectable()
export class InternalKeyGuard implements CanActivate {
  private readonly expected = process.env.INTERNAL_API_KEY;

  canActivate(context: ExecutionContext): boolean {
    const provided = context.switchToHttp().getRequest<Request>().header(INTERNAL_KEY_HEADER);
    if (!this.expected || this.expected.length < 32 || !provided || !timingSafeEqual(digest(provided), digest(this.expected))) {
      throw new UnauthorizedException('Llave interna inválida');
    }
    return true;
  }
}
