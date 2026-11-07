import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { AuthResponseDto } from './dto/auth-response.dto';
import { RefreshTokenGuard } from './guards/refresh-token.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { MobileAccessService, mobileAttestationRequired, mobileChannelMismatch } from '../mobile-access/mobile-access.service';
import { MobileLoginDto, MobileRefreshDto, MobileRegisterDto } from '../mobile-access/dto/mobile-attestation.dto';
import { isDevelopmentBypassAllowed, loadMobileAccessConfig } from '../mobile-access/mobile-access.config';
import type { RefreshUser } from './strategies/refresh-token.strategy';

/**
 * Canal móvil (app oficial). A diferencia de /auth/login, acá la API decide:
 *   1. que el plan VIGENTE de la tienda incluya mobileApp (Pro / Legacy),
 *   2. que el dispositivo pruebe ser la app oficial sin modificar (Play Integrity / App Attest) contra
 *      un desafío de un solo uso ligado a la tienda,
 * y recién entonces emite tokens con channel: "mobile". Ningún header del cliente habilita este canal.
 */
@ApiTags('auth-mobile')
@Controller('auth/mobile')
export class MobileAuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly mobileAccess: MobileAccessService,
  ) {}

  @Post('challenge')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Desafío de un solo uso para la prueba de integridad de la app móvil' })
  @ApiResponse({ status: 403, description: 'MOBILE_APP_NOT_IN_PLAN: el plan de la tienda no incluye la app móvil' })
  challenge(@Req() req: Request) {
    return this.mobileAccess.issueChallenge(req.tenant!.tenantId);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Login desde la app móvil oficial (requiere plan con app móvil y prueba de integridad)' })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  async login(@Req() req: Request, @Body() dto: MobileLoginDto): Promise<AuthResponseDto> {
    const tenantId = req.tenant!.tenantId;
    await this.mobileAccess.assertMobilePlan(tenantId);
    // La prueba va ANTES de mirar la contraseña: probar contraseñas por este canal cuesta una
    // prueba de integridad válida por intento
    const claims = await this.mobileAccess.verify(tenantId, dto.attestation);
    return this.authService.login(dto, claims);
  }

  @Post('register')
  @HttpCode(201)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Registro desde la app móvil oficial' })
  @ApiResponse({ status: 201, type: AuthResponseDto })
  async register(@Req() req: Request, @Body() dto: MobileRegisterDto): Promise<AuthResponseDto> {
    const tenantId = req.tenant!.tenantId;
    await this.mobileAccess.assertMobilePlan(tenantId);
    const claims = await this.mobileAccess.verify(tenantId, dto.attestation);
    const { attestation: _attestation, ...registerDto } = dto;
    return this.authService.register(registerDto, claims);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RefreshTokenGuard)
  @ApiBearerAuth('JWT-refresh')
  @ApiOperation({
    summary: 'Renovar una sesión móvil',
    description:
      'Vuelve a leer el plan vigente. Si la última prueba de integridad es más vieja que MOBILE_REATTEST_AFTER_MS responde 401 MOBILE_ATTESTATION_REQUIRED y hay que reenviar con attestation.',
  })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  async refresh(@Req() req: Request, @GetUser() user: RefreshUser, @Body() dto: MobileRefreshDto): Promise<AuthResponseDto> {
    // Un refresh token web no se convierte en sesión móvil: para eso hay que pasar por login móvil
    if (user.channel !== 'mobile' || !user.mobile) throw mobileChannelMismatch();
    const tenantId = req.tenant!.tenantId;
    await this.mobileAccess.assertMobilePlan(tenantId);

    let claims = user.mobile;
    if (dto.attestation) {
      claims = await this.mobileAccess.verify(tenantId, dto.attestation);
    } else {
      const stale = Date.now() - claims.attestedAt > loadMobileAccessConfig().reattestAfterMs;
      // Una sesión creada con el atajo de desarrollo no sobrevive a un servidor que ya no lo permite
      const bypassRevoked = claims.method === 'development-bypass' && !isDevelopmentBypassAllowed();
      if (stale || bypassRevoked) throw mobileAttestationRequired();
    }
    return this.authService.refreshTokens(user.id, claims);
  }
}
