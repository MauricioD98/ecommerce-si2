import { BadGatewayException, Body, Controller, HttpCode, HttpStatus, Ip, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { MailService } from '../mail/mail.service';
import { i18nMessage } from '../../i18n/i18n-message';
import { ContactDto } from './dto/contact.dto';

// /api/v1/platform/contact: excluido de TenantMiddleware por estar bajo platform/* (el visitante de
// la landing no pertenece a ninguna tienda).
@ApiTags('platform')
@Controller('platform/contact')
export class ContactController {
  constructor(private readonly mail: MailService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 10 * 60_000 } }) // es un formulario anónimo: frena el spam
  @ApiOperation({ summary: 'Formulario de contacto de la landing → bandeja de soporte' })
  async send(@Body() dto: ContactDto, @Ip() ip: string) {
    // Honeypot completado = bot. Se responde igual que un envío real para no darle pistas.
    if (dto.website) return { success: true, data: null, message: 'Mensaje enviado' };

    const sent = await this.mail.sendContactMessage({ name: dto.name, email: dto.email, message: dto.message, ip });
    if (!sent) throw new BadGatewayException(i18nMessage('errors.CONTACT_SEND_FAILED'));
    return { success: true, data: null, message: 'Mensaje enviado. Te responderemos pronto.' };
  }
}
