import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/decorators/guards/jwt-auth.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { NotificationsService } from './notifications.service';
import { SubscribePushDto } from './dto/subscribe-push.dto';

@ApiTags('notifications')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('vapid-public-key')
  @ApiOperation({ summary: 'Obtener la llave pública VAPID para suscribirse a notificaciones push' })
  @ApiOkResponse({ description: 'Llave pública VAPID (null si el servicio no está configurado)' })
  getVapidPublicKey() {
    return this.notificationsService.getPublicKey();
  }

  @Post('subscribe')
  @ApiOperation({ summary: 'Registrar o actualizar la suscripción push del dispositivo actual' })
  @ApiOkResponse({ description: 'Suscripción guardada correctamente' })
  subscribe(@GetUser('id') userId: string, @Body() dto: SubscribePushDto) {
    return this.notificationsService.subscribe(userId, dto);
  }
}
