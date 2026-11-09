import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/decorators/guards/jwt-auth.guard';
import { PlanFeatureGuard } from '../../common/decorators/guards/plan-feature.guard';
import { RequirePlanFeature } from '../../common/decorators/plan-feature.decorator';
import type { RequestWithUser } from '../../common/decorators/interfaces/request-with-user.interface';
import { TryOnService } from './try-on.service';

@ApiTags('try-on')
@Controller('try-on')
export class TryOnController {
  constructor(private readonly tryOnService: TryOnService) {}

  // Cada sesión cuesta dinero real: solo usuarios autenticados de ESTA tienda y solo en el Plan Pro.
  @Post('session')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PlanFeatureGuard)
  @RequirePlanFeature('virtualTryOn')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Token efímero para el Probador Virtual (Decart) de la tienda actual (Plan Pro)' })
  createSession(@Headers('origin') origin?: string) {
    return this.tryOnService.createSession(origin);
  }

  // Probador en vivo de la app móvil (Decart lucy-2.5): mismos guards y plan que la sesión web, más
  // tope de peticiones por IP y los límites por cliente y tienda del servicio.
  @Post('live-session')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PlanFeatureGuard, ThrottlerGuard)
  @RequirePlanFeature('virtualTryOn')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Sesión en vivo del Probador Virtual (lucy-2.5): token de cliente limitado y prenda de referencia (Plan Pro)' })
  async createLiveSession(@Req() req: RequestWithUser, @Body('productId') productId: unknown, @Body('clientTime') clientTime: unknown) {
    return { success: true, data: await this.tryOnService.createLiveSession(req.user, productId, clientTime) };
  }

  // Para mostrar el máximo antes de iniciar (no firma nada ni consume cupo)
  @Get('live-config')
  @UseGuards(JwtAuthGuard, PlanFeatureGuard)
  @RequirePlanFeature('virtualTryOn')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Duración máxima configurada de la sesión en vivo del probador' })
  liveConfig() {
    return { success: true, data: this.tryOnService.liveConfig() };
  }

  @Post('live-session/:id/end')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Avisa que el cliente terminó la sesión en vivo del probador' })
  endLiveSession(@Req() req: RequestWithUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return { success: true, data: this.tryOnService.endLiveSession(req.user, id) };
  }
}
