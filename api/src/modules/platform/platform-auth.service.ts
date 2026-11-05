import { HttpException, HttpStatus, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { i18nMessage } from '../../i18n/i18n-message';
import { ControlPrismaService } from '../../tenancy/control-prisma.service';
import { TenantPrismaService } from '../../tenancy/tenant-prisma.service';
import { runInTenant } from '../../tenancy/tenant-context';
import { AuthService } from '../auth/auth.service';
import { AuthResponseDto } from '../auth/dto/auth-response.dto';
import { USER_SELECT } from '../users/user.mapper';
import { TenantDiscoveryLoginDto } from './dto/tenant-discovery-login.dto';

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

export interface TenantPublicSummary {
  id: string;
  slug: string;
  name: string;
  plan: string;
}

export interface TenantMatchOption extends TenantPublicSummary {
  role: string;
}

export type TenantDiscoveryLoginResult =
  | {
      isPlatformAdmin?: false;
      requiresTenantSelection: false;
      tenant: TenantPublicSummary;
      auth: AuthResponseDto;
    }
  | {
      isPlatformAdmin?: false;
      requiresTenantSelection: true;
      tenants: TenantMatchOption[];
    }
  | {
      isPlatformAdmin: true;
      requiresTenantSelection: false;
      accessToken: string;
      expiresIn: number;
      admin: PlatformAdminProfile;
      redirectUrl: string;
    };

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
    private readonly tenants: TenantPrismaService,
    private readonly tenantAuth: AuthService,
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

  /**
   * Login inteligente multi-tienda para dueños, empleados y clientes:
   * - Si `tenantId` viene explícito, autentica directamente en esa tienda.
   * - Si se omite `tenantId`, busca el email en todas las tiendas activas:
   *    - 1 coincidencia de (email + contraseña) → inicia sesión automáticamente en esa tienda.
   *    - 2+ coincidencias (p. ej. mismo cliente registrado con igual clave en varias tiendas) →
   *      devuelve `requiresTenantSelection: true` con las tiendas coincidentes para que el usuario elija.
   */
  async tenantLogin(dto: TenantDiscoveryLoginDto): Promise<TenantDiscoveryLoginResult> {
    const cleanEmail = dto.email.trim();
    const normalizedEmail = normalizeAdminEmail(cleanEmail);

    // Si las credenciales corresponden a un administrador de plataforma (NovaSoft),
    // inicia sesión directamente en el panel de plataforma
    const platformAdmin = await this.control.platformAdmin.findUnique({
      where: { email: normalizedEmail },
    });

    if (platformAdmin && platformAdmin.isActive) {
      if (platformAdmin.lockedUntil && platformAdmin.lockedUntil > new Date()) {
        const minutes = Math.ceil((platformAdmin.lockedUntil.getTime() - Date.now()) / 60_000);
        throw new HttpException(
          i18nMessage('errors.TOO_MANY_ATTEMPTS', { count: minutes }),
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      const validPlatformPass = await bcrypt.compare(dto.password, platformAdmin.passwordHash);
      if (validPlatformPass) {
        if (platformAdmin.loginAttempts > 0 || platformAdmin.lockedUntil) {
          await this.control.platformAdmin.update({
            where: { id: platformAdmin.id },
            data: { loginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
          });
        } else {
          await this.control.platformAdmin.update({
            where: { id: platformAdmin.id },
            data: { lastLoginAt: new Date() },
          });
        }

        const secret = platformJwtSecret();
        if (!secret) throw new UnauthorizedException(i18nMessage('errors.INVALID_CREDENTIALS'));

        const payload: PlatformTokenPayload = { sub: platformAdmin.id, email: platformAdmin.email };
        const accessToken = await this.jwt.signAsync(payload, {
          secret,
          audience: PLATFORM_TOKEN_AUDIENCE,
          expiresIn: TOKEN_TTL_SECONDS,
        });

        return {
          isPlatformAdmin: true,
          requiresTenantSelection: false,
          accessToken,
          expiresIn: TOKEN_TTL_SECONDS,
          admin: { id: platformAdmin.id, email: platformAdmin.email, name: platformAdmin.name },
          redirectUrl: '/plataforma',
        };
      }
    }

    if (dto.tenantId) {
      const tenant = await this.control.tenant.findFirst({
        where: { id: dto.tenantId, status: 'ACTIVE' },
        select: { id: true, slug: true, name: true, schemaName: true, plan: true },
      });
      if (!tenant) {
        throw new NotFoundException('La tienda seleccionada no está disponible');
      }
      const auth = await runInTenant(
        { tenantId: tenant.id, schemaName: tenant.schemaName, plan: tenant.plan },
        () => this.tenantAuth.login({ email: cleanEmail, password: dto.password }),
      );
      return {
        requiresTenantSelection: false,
        tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name, plan: tenant.plan },
        auth,
      };
    }

    const activeTenants = await this.control.tenant.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, slug: true, name: true, schemaName: true, plan: true },
    });

    const lookups = await Promise.all(
      activeTenants.map(async (tenant) => {
        try {
          const user = await this.tenants.forSchema(tenant.schemaName).user.findFirst({
            where: {
              email: { equals: cleanEmail, mode: 'insensitive' },
              NOT: { email: { endsWith: '@pos.stellafemme.internal' } },
            },
            select: { ...USER_SELECT, password: true, loginAttempts: true, lockedUntil: true },
          });
          return user ? { tenant, user } : null;
        } catch (err) {
          this.logger.error(
            `No se pudo consultar usuarios en ${tenant.schemaName} (${tenant.slug}): ${(err as Error).message}`,
          );
          return null;
        }
      }),
    );

    const candidates = lookups.filter((item): item is NonNullable<typeof item> => item !== null);
    if (candidates.length === 0) {
      if (platformAdmin && platformAdmin.isActive) {
        const attempts = (platformAdmin.lockedUntil ? 0 : platformAdmin.loginAttempts) + 1;
        const locked = attempts >= MAX_ATTEMPTS;
        await this.control.platformAdmin.update({
          where: { id: platformAdmin.id },
          data: locked
            ? { loginAttempts: 0, lockedUntil: new Date(Date.now() + LOCK_MS) }
            : { loginAttempts: attempts, lockedUntil: null },
        });
        if (locked) {
          this.logger.warn(`Administrador de plataforma bloqueado por intentos fallidos: ${platformAdmin.email}`);
          throw new HttpException(i18nMessage('errors.ACCOUNT_LOCKED'), HttpStatus.TOO_MANY_REQUESTS);
        }
      }
      await bcrypt.compare(dto.password, DUMMY_HASH);
      throw new UnauthorizedException(i18nMessage('errors.INVALID_CREDENTIALS'));
    }

    const now = new Date();
    const lockedCandidates = candidates.filter((c) => c.user.lockedUntil && c.user.lockedUntil > now);
    const unlockedCandidates = candidates.filter((c) => !c.user.lockedUntil || c.user.lockedUntil <= now);

    if (unlockedCandidates.length === 0) {
      const maxRemainingMs = Math.max(...lockedCandidates.map((c) => (c.user.lockedUntil?.getTime() ?? now.getTime()) - now.getTime()));
      const minutes = Math.max(1, Math.ceil(maxRemainingMs / 60_000));
      throw new HttpException(
        i18nMessage('errors.TOO_MANY_ATTEMPTS', { count: minutes }),
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const checks = await Promise.all(
      unlockedCandidates.map(async (c) => ({
        ...c,
        valid: await bcrypt.compare(dto.password, c.user.password),
      })),
    );
    const matched = checks.filter((c) => c.valid);

    if (matched.length === 0) {
      // Solo se incrementan intentos fallidos si NINGUNA tienda coincidió con la contraseña: así un
      // cliente con claves distintas en dos tiendas no bloquea la Tienda B al entrar a la Tienda A.
      const lockResults = await Promise.all(
        unlockedCandidates.map((c) =>
          runInTenant(
            { tenantId: c.tenant.id, schemaName: c.tenant.schemaName, plan: c.tenant.plan },
            () => this.tenantAuth.recordFailedLoginAttempt(c.user),
          ),
        ),
      );
      if (lockResults.some(Boolean)) {
        throw new HttpException(i18nMessage('errors.ACCOUNT_LOCKED'), HttpStatus.TOO_MANY_REQUESTS);
      }
      throw new UnauthorizedException(i18nMessage('errors.INVALID_CREDENTIALS'));
    }

    if (matched.length === 1) {
      const winner = matched[0];
      const auth = await runInTenant(
        { tenantId: winner.tenant.id, schemaName: winner.tenant.schemaName, plan: winner.tenant.plan },
        () => this.tenantAuth.issueSessionForUser(winner.user),
      );
      return {
        requiresTenantSelection: false,
        tenant: {
          id: winner.tenant.id,
          slug: winner.tenant.slug,
          name: winner.tenant.name,
          plan: winner.tenant.plan,
        },
        auth,
      };
    }

    const sorted = [...matched].sort((a, b) => {
      if (dto.preferredTenantId) {
        if (a.tenant.id === dto.preferredTenantId) return -1;
        if (b.tenant.id === dto.preferredTenantId) return 1;
      }
      return 0;
    });

    return {
      requiresTenantSelection: true,
      tenants: sorted.map((m) => ({
        id: m.tenant.id,
        slug: m.tenant.slug,
        name: m.tenant.name,
        plan: m.tenant.plan,
        role: m.user.role.name,
      })),
    };
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
