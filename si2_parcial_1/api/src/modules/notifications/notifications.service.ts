import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscribePushDto } from './dto/subscribe-push.dto';

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  url?: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly publicKey?: string;
  private readonly enabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.publicKey = this.config.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY');
    const subject = this.config.get<string>('VAPID_SUBJECT');

    // Sin llaves VAPID el servicio queda deshabilitado (no rompe el arranque en dev sin configurar)
    this.enabled = Boolean(this.publicKey && privateKey && subject);
    if (this.enabled) {
      webpush.setVapidDetails(subject!, this.publicKey!, privateKey!);
    } else {
      this.logger.warn('VAPID keys no configuradas: las notificaciones push están deshabilitadas.');
    }
  }

  getPublicKey(): { publicKey: string | null } {
    return { publicKey: this.publicKey ?? null };
  }

  // Guarda o actualiza (por endpoint) la suscripción del dispositivo del usuario autenticado
  async subscribe(userId: string, dto: SubscribePushDto): Promise<{ success: true }> {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: {
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        userId,
      },
      update: {
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        userId,
      },
    });
    return { success: true };
  }

  // Envía una notificación a todos los dispositivos suscritos del usuario. Nunca lanza: es un side-effect best-effort
  async sendPushNotification(userId: string, payload: PushPayload): Promise<void> {
    if (!this.enabled) return;

    const subscriptions = await this.prisma.pushSubscription.findMany({ where: { userId } });
    if (subscriptions.length === 0) return;

    const body = JSON.stringify(payload);

    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            body,
          );
        } catch (error) {
          const statusCode = (error as { statusCode?: number }).statusCode;
          // 404/410: el navegador invalidó la suscripción, se limpia de la BD
          if (statusCode === 404 || statusCode === 410) {
            await this.prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
          } else {
            this.logger.error(`Error enviando push a ${sub.id}: ${(error as Error).message}`);
          }
        }
      }),
    );
  }
}
