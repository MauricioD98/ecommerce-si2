import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ControlPrismaService } from '../../../tenancy/control-prisma.service';
import { PLATFORM_KEY_HEADER, PlatformAdminGuard } from '../guards/platform-admin.guard';
import { AuditQueryDto } from './audit-query.dto';
import { PlatformAuditService } from './platform-audit.service';

/**
 * Administradores del SaaS y auditoría. Solo PlatformAdminGuard: un usuario de tienda (aunque sea su dueño o
 * Super Admin) no es administrador de plataforma y recibe 401. /platform/* no pasa por TenantMiddleware.
 */
@ApiTags('platform')
@Controller('platform')
@UseGuards(PlatformAdminGuard)
@ApiBearerAuth('JWT-auth')
@ApiHeader({ name: PLATFORM_KEY_HEADER, required: false })
export class PlatformAuditController {
  constructor(
    private readonly audit: PlatformAuditService,
    private readonly control: ControlPrismaService,
  ) {}

  @Get('admins')
  @ApiOperation({ summary: 'Administradores de la plataforma y su estado (sin hashes ni contadores internos)' })
  async admins() {
    const rows = await this.control.platformAdmin.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, name: true, isActive: true, lockedUntil: true, lastLoginAt: true, createdAt: true },
    });
    const now = new Date();
    const data = rows.map(({ lockedUntil, ...admin }) => ({
      ...admin,
      // Bloqueo temporal por intentos fallidos (se levanta solo al vencer)
      lockedUntil: lockedUntil && lockedUntil > now ? lockedUntil : null,
    }));
    return { success: true, data, message: 'Administradores de plataforma' };
  }

  @Get('audit')
  @ApiOperation({ summary: 'Registro de acciones del panel de plataforma (más recientes primero)' })
  async list(@Query() query: AuditQueryDto) {
    const toDate = (value?: string) => (value ? new Date(value) : undefined);
    const data = await this.audit.list({
      action: query.action,
      tenantId: query.tenantId,
      actorEmail: query.actorEmail,
      result: query.result,
      from: toDate(query.from),
      to: toDate(query.to),
      before: toDate(query.before),
      limit: query.limit,
    });
    return { success: true, data, message: 'Auditoría' };
  }
}
