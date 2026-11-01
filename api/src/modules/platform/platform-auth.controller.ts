import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { PlatformLoginDto } from './dto/platform-login.dto';
import { PlatformAdminGuard } from './guards/platform-admin.guard';
import { PlatformAuthService } from './platform-auth.service';

// Login de los administradores del SaaS (/plataforma). Va bajo /platform, excluido de TenantMiddleware.
@ApiTags('platform')
@Controller('platform/auth')
export class PlatformAuthController {
  constructor(private readonly auth: PlatformAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  // Además del bloqueo por cuenta: frena probar muchos emails desde la misma IP
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Login de administrador de plataforma (email y contraseña)' })
  async login(@Body() dto: PlatformLoginDto) {
    const data = await this.auth.login(dto.email, dto.password);
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
