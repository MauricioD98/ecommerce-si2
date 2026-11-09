import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/decorators/guards/jwt-auth.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { assertPlanFeature, currentPlanFeatures } from '../platform/plans';
import { NotificationsService } from './notifications.service';
import { SubscribePushDto } from './dto/subscribe-push.dto';
import { PushEndpointDto, PushTestDto } from './dto/push-endpoint.dto';

@ApiTags('notifications')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('vapid-public-key')
  @ApiOperation({ summary: 'Obtener la llave pública VAPID para suscribirse a notificaciones push' })
  @ApiOkResponse({
    description:
      'Llave pública VAPID de la tienda actual. Si es null, `reason` indica por qué: PLAN_NOT_INCLUDED (el plan no incluye push) o NOT_CONFIGURED (la tienda no tiene llaves)',
  })
  getVapidPublicKey() {
    if (!currentPlanFeatures().campaigns) {
      return { publicKey: null, reason: 'PLAN_NOT_INCLUDED' as const };
    }
    return this.notificationsService.getPublicKey();
  }

  @Post('subscribe')
  @ApiOperation({ summary: 'Registrar o actualizar la suscripción push del dispositivo actual (Plan Pro)' })
  @ApiOkResponse({ description: 'Suscripción guardada correctamente' })
  subscribe(@GetUser('id') userId: string, @Body() dto: SubscribePushDto) {
    assertPlanFeature('campaigns');
    return this.notificationsService.subscribe(userId, dto);
  }

  // No exige el plan: una tienda que bajó de plan igual debe poder mostrar el estado real y limpiar
  @Post('subscription-status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Indica si el navegador actual (endpoint) recibe los push de este usuario en esta tienda' })
  @ApiOkResponse({ description: '{ subscribed: boolean }' })
  status(@GetUser('id') userId: string, @Body() dto: PushEndpointDto) {
    return this.notificationsService.isSubscribed(userId, dto.endpoint);
  }

  @Post('unsubscribe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Desvincular el navegador actual de este usuario en esta tienda (al cerrar sesión o desactivar)' })
  @ApiOkResponse({ description: 'Suscripción eliminada (si era de este usuario)' })
  unsubscribe(@GetUser('id') userId: string, @Body() dto: PushEndpointDto) {
    return this.notificationsService.unsubscribe(userId, dto.endpoint);
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Enviar una notificación de prueba solo al navegador actual del usuario (Plan Pro)' })
  @ApiOkResponse({ description: '{ accepted, reason }: accepted = el push service aceptó el mensaje (no garantiza que se haya mostrado)' })
  test(@GetUser('id') userId: string, @Body() dto: PushTestDto) {
    assertPlanFeature('campaigns');
    return this.notificationsService.sendTest(userId, dto.endpoint, { title: dto.title, body: dto.body });
  }
}
