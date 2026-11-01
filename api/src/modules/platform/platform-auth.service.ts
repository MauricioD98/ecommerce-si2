import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { i18nMessage } from '../../i18n/i18n-message';
import { ControlPrismaService } from '../../tenancy/control-prisma.service';

// Mismo criterio que el login de las tiendas (AuthService): tras MAX_ATTEMPTS fallos seguidos la
// cuenta queda bloqueada LOCK_MS (el mensaje ACCOUNT_LOCKED dice 5 minutos)
const MAX_ATTEMPTS = 5;
const LOCK_MS = 5 * 60_000;
const SALT_ROUNDS = 12;
// Sin refresh token: al vencer, el panel vuelve a pedir email y contraseña
const TOKEN_TTL_SECONDS = 8 * 60 * 60;
// El audience separa estos tokens de los de las tiendas aunque compartan JWT_SECRET: un token de
// tienda no pasa PlatformAdminGuard, y uno de plataforma no trae tenantId/rol para JwtStrategy
export const PLATFORM_TOKEN_AUDIENCE = 'stella-platform';
// Hash de una contraseña cualquiera: si el email no existe se compara igual contra este, para que el
// tiempo de respuesta no revele qué emails son administradores
const DUMMY_HASH = bcrypt.hashSync('platform-admin-timing-guard', 10);

export interface PlatformAdminProfile {
  id: string;
  email: string;
  name: string | null;
}

interface PlatformTokenPayload {
  sub: string;
  email: string;
}

export const platformJwtSecret = (): string | undefined =>
  process.env.PLATFORM_JWT_SECRET?.trim() || process.env.JWT_SECRET?.trim() || undefined;

export const normalizeAdminEmail = (email: string) => email.trim().toLowerCase();

export const hashAdminPassword = (password: string) => bcrypt.hash(password, SALT_ROUNDS);

@Injectable()
export class PlatformAuthService {
  private readonly logger = new Logger(PlatformAuthService.name);

  constructor(
    private readonly control: ControlPrismaService,
    private readonly jwt: JwtService,
  ) {
    if (!platformJwtSecret()) {
      this.logger.warn('Sin PLATFORM_JWT_SECRET ni JWT_SECRET: el login de plataforma queda deshabilitado');
    }
  }

  async login(email: string, password: string): Promise<{ accessToken: string; expiresIn: number; admin: PlatformAdminProfile }> {
    const secret = platformJwtSecret();
    if (!secret) throw new UnauthorizedException(i18nMessage('errors.INVALID_CREDENTIALS'));

    const admin = await this.control.platformAdmin.findUnique({ where: { email: normalizeAdminEmail(email) } });

    if (admin?.lockedUntil && admin.lockedUntil > new Date()) {
      const minutes = Math.ceil((admin.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new UnauthorizedException(i18nMessage('errors.TOO_MANY_ATTEMPTS', { count: minutes }));
    }

    const valid = await bcrypt.compare(password, admin?.passwordHash ?? DUMMY_HASH);
    if (!admin || !valid || !admin.isActive) {
      if (admin && !valid) {
        const attempts = (admin.lockedUntil ? 0 : admin.loginAttempts) + 1;
        const locked = attempts >= MAX_ATTEMPTS;
        await this.control.platformAdmin.update({
          where: { id: admin.id },
          data: locked
            ? { loginAttempts: 0, lockedUntil: new Date(Date.now() + LOCK_MS) }
            : { loginAttempts: attempts, lockedUntil: null },
        });
        if (locked) {
          this.logger.warn(`Administrador de plataforma bloqueado por intentos fallidos: ${admin.email}`);
          throw new UnauthorizedException(i18nMessage('errors.ACCOUNT_LOCKED'));
        }
      }
      throw new UnauthorizedException(i18nMessage('errors.INVALID_CREDENTIALS'));
    }

    await this.control.platformAdmin.update({
      where: { id: admin.id },
      data: { loginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    const payload: PlatformTokenPayload = { sub: admin.id, email: admin.email };
    const accessToken = await this.jwt.signAsync(payload, {
      secret,
      audience: PLATFORM_TOKEN_AUDIENCE,
      expiresIn: TOKEN_TTL_SECONDS,
    });
    return { accessToken, expiresIn: TOKEN_TTL_SECONDS, admin: { id: admin.id, email: admin.email, name: admin.name } };
  }

  /** Administrador del token, o null si el token es inválido/vencido o la cuenta ya no está activa. */
  async verify(token: string): Promise<PlatformAdminProfile | null> {
    const secret = platformJwtSecret();
    if (!secret) return null;
    let payload: PlatformTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<PlatformTokenPayload>(token, { secret, audience: PLATFORM_TOKEN_AUDIENCE });
    } catch {
      return null;
    }
    // Se consulta en cada request: desactivar una cuenta corta sus sesiones al instante
    const admin = await this.control.platformAdmin.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, isActive: true },
    });
    if (!admin?.isActive) return null;
    return { id: admin.id, email: admin.email, name: admin.name };
  }
}
