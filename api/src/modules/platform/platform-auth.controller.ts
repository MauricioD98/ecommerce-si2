import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { PlatformLoginDto } from './dto/platform-login.dto';
import { TenantLoginDto } from './dto/tenant-login.dto';
import { PlatformAdminGuard } from './guards/platform-admin.guard';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformAuditService, auditErrorCode } from './audit/platform-audit.service';

// Login de los administradores del SaaS (/plataforma, JWT de plataforma) y login de usuarios en la
// tienda que eligieron antes de autenticar (JWT de tienda). Va bajo /platform, excluido de TenantMiddleware.
@ApiTags('platform')
@Controller('platform/auth')
export class PlatformAuthController {
  constructor(
    private readonly auth: PlatformAuthService,
    private readonly audit: PlatformAuditService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  // Además del bloqueo por cuenta: frena probar muchos emails desde la misma IP
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Login de administrador de plataforma (email y contraseña)' })
  async login(@Body() dto: PlatformLoginDto) {
    // Auditoría: el intento (exitoso o no) con el email usado. Nunca la contraseña ni el token emitido.
    try {
      const data = await this.auth.login(dto.email, dto.password);
      await this.audit.record({
        actor: { type: 'PLATFORM_ADMIN', id: data.admin.id, email: data.admin.email },
        action: 'PLATFORM_LOGIN',
        result: 'SUCCESS',
      });
      return { success: true, data, message: 'Sesión iniciada' };
    } catch (error) {
      await this.audit.record({
        actor: { type: 'ANONYMOUS', id: null, email: String(dto.email ?? '').trim().toLowerCase().slice(0, 254) || null },
        action: 'PLATFORM_LOGIN',
        result: 'FAILURE',
        errorCode: auditErrorCode(error),
      });
      throw error;
    }
  }

  @Post('tenant-login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Login en la tienda elegida (tenantId obligatorio)',
    description:
      'Consulta las credenciales solo en esa tienda. Cualquier fallo (tienda inválida o suspendida, correo inexistente, contraseña incorrecta, cuenta bloqueada) responde 401 con el mismo mensaje.',
  })
  async tenantLogin(@Body() dto: TenantLoginDto) {
    const data = await this.auth.tenantLogin(dto);
    return { success: true, data, message: 'Sesión iniciada' };
  }

  @Get('me')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Administrador de plataforma de la sesión actual' })
  me(@Req() req: Request) {
    return { success: true, data: req.platformAdmin ?? null, message: 'Administrador actual' };
  }
}
