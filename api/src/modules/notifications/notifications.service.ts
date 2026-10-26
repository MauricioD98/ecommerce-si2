import { Injectable, Logger } from '@nestjs/common';
import * as webpush from 'web-push';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscribePushDto } from './dto/subscribe-push.dto';
import { withTenantParam } from '../../tenancy/tenant-context';
import { TenantSecretsService, WebPushCredentials } from '../../tenancy/tenant-secrets.service';

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  url?: string;
}

/**
 * Web Push por tienda. Antes había un único par VAPID global (VAPID_* del .env) fijado con
 * webpush.setVapidDetails() al arrancar; ahora cada tienda tiene el suyo en
 * public.tenant_integrations y se pasa por envío (options.vapidDetails), así el servicio @Global()
 * no guarda estado de ninguna tienda.
 *
 * Una suscripción queda atada a la llave pública con la que se creó: cambiar el par de una tienda
 * obliga a sus dispositivos a volver a suscribirse. Por eso la tienda original importa el par que
 * ya usaba (src/scripts/import-legacy-integrations.ts) y las nuevas lo generan al nacer.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: TenantSecretsService,
  ) {}

  // null si la tienda no tiene push configurado: el front simplemente no ofrece suscribirse
  async getPublicKey(): Promise<{ publicKey: string | null }> {
    const vapid = await this.vapidDetails();
    return { publicKey: vapid?.publicKey ?? null };
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
    let vapidDetails: WebPushCredentials | null;
    try {
      vapidDetails = await this.vapidDetails();
    } catch (error) {
      this.logger.error(`No se pudieron leer las llaves VAPID de la tienda: ${(error as Error).message}`);
      return;
    }
    if (!vapidDetails) return;

    const subscriptions = await this.prisma.pushSubscription.findMany({ where: { userId } });
    if (subscriptions.length === 0) return;

    // La URL que abre el click de la notificación lleva la tienda: el dispositivo pudo haber cambiado
    // de tienda desde que se suscribió (ver withTenantParam). Se aplica acá para cubrir a todos los
    // que llaman a este método (pagos, pedidos, campañas).
    const body = JSON.stringify(payload.url ? { ...payload, url: withTenantParam(payload.url) } : payload);

    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            body,
            { vapidDetails },
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

  // El par VAPID de cada tienda lo genera TenantProvisioningService.ensureWebPushKeys (al alta)
  private async vapidDetails(): Promise<WebPushCredentials | null> {
    const vapid = await this.secrets.get('WEBPUSH');
    return vapid?.publicKey && vapid.privateKey && vapid.subject ? vapid : null;
  }
}
