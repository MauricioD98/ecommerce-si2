import { Injectable, Logger } from '@nestjs/common';
import * as webpush from 'web-push';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscribePushDto } from './dto/subscribe-push.dto';
import { withTenantParam } from '../../tenancy/tenant-context';
import { TenantSecretsService, WebPushCredentials } from '../../tenancy/tenant-secrets.service';

// PLAN_NOT_INCLUDED: el plan de la tienda no incluye push. NOT_CONFIGURED: la tienda no tiene par VAPID.
export type PushUnavailableReason = 'PLAN_NOT_INCLUDED' | 'NOT_CONFIGURED';

export interface PushTestResult {
  accepted: boolean;
  reason: 'NOT_CONFIGURED' | 'NOT_SUBSCRIBED' | 'EXPIRED' | 'PUSH_SERVICE_ERROR' | null;
  // Código HTTP del push service (201 = aceptado): diagnóstico sin exponer el endpoint
  pushStatus?: number;
}

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

  // null si la tienda no tiene push configurado; `reason` le dice al front qué explicar en vez de
  // un aviso genérico. Las restricciones de plan las resuelve el controlador antes de llegar acá.
  async getPublicKey(): Promise<{ publicKey: string | null; reason: PushUnavailableReason | null }> {
    const vapid = await this.vapidDetails();
    return vapid ? { publicKey: vapid.publicKey, reason: null } : { publicKey: null, reason: 'NOT_CONFIGURED' };
  }

  // ¿Este endpoint (el navegador actual) está registrado a nombre de este usuario en ESTA tienda?
  // El navegador puede conservar una suscripción que en el backend quedó a nombre de otra cuenta
  // (cambio de usuario) o que se limpió por un 404/410: el front no debe mostrarla como activa.
  async isSubscribed(userId: string, endpoint: string): Promise<{ subscribed: boolean }> {
    const found = await this.prisma.pushSubscription.findFirst({ where: { endpoint, userId }, select: { id: true } });
    return { subscribed: Boolean(found) };
  }

  // Desvincula SOLO el endpoint indicado y solo si es del usuario autenticado: cerrar sesión en esta
  // tienda nunca toca suscripciones de otras cuentas ni de otras tiendas (cada tienda tiene su schema).
  async unsubscribe(userId: string, endpoint: string): Promise<{ success: true }> {
    await this.prisma.pushSubscription.deleteMany({ where: { endpoint, userId } });
    return { success: true };
  }

  // Notificación de prueba al navegador que la pide, y a ningún otro dispositivo del usuario.
  // `accepted` solo significa que el push service (FCM, Mozilla, Apple…) aceptó el mensaje; que se
  // muestre depende del navegador (permiso, service worker vivo). El front lo aclara.
  async sendTest(userId: string, endpoint: string, text: { title?: string; body?: string } = {}): Promise<PushTestResult> {
    const vapidDetails = await this.vapidDetails();
    if (!vapidDetails) return { accepted: false, reason: 'NOT_CONFIGURED' };
    const sub = await this.prisma.pushSubscription.findFirst({ where: { endpoint, userId } });
    if (!sub) return { accepted: false, reason: 'NOT_SUBSCRIBED' };

    // El texto lo manda el front ya traducido; solo puede llegar al propio navegador de quien lo pide
    const body = JSON.stringify({
      title: text.title || 'Notificación de prueba',
      body: text.body || 'Las notificaciones push de esta tienda funcionan en este navegador.',
      url: withTenantParam('/account'),
    });
    const { outcome, statusCode } = await this.deliver(sub, body, vapidDetails);
    if (outcome === 'ok') return { accepted: true, reason: null, pushStatus: statusCode };
    return { accepted: false, reason: outcome === 'gone' ? 'EXPIRED' : 'PUSH_SERVICE_ERROR', pushStatus: statusCode };
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

    await Promise.all(subscriptions.map((sub) => this.deliver(sub, body, vapidDetails)));
  }

  private async deliver(
    sub: { id: string; endpoint: string; p256dh: string; auth: string },
    body: string,
    vapidDetails: WebPushCredentials,
  ): Promise<{ outcome: 'ok' | 'gone' | 'error'; statusCode?: number }> {
    try {
      const response = await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body, {
        vapidDetails,
      });
      return { outcome: 'ok', statusCode: response.statusCode };
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      // 404/410: el navegador invalidó la suscripción, se limpia de la BD
      if (statusCode === 404 || statusCode === 410) {
        await this.prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
        return { outcome: 'gone', statusCode };
      }
      // Sin el endpoint: es la dirección privada del dispositivo
      this.logger.error(`Error enviando push a ${sub.id} (HTTP ${statusCode ?? '-'}): ${(error as Error).message}`);
      return { outcome: 'error', statusCode };
    }
  }

  // El par VAPID de cada tienda lo genera TenantProvisioningService.ensureWebPushKeys (al alta)
  private async vapidDetails(): Promise<WebPushCredentials | null> {
    const vapid = await this.secrets.get('WEBPUSH');
    return vapid?.publicKey && vapid.privateKey && vapid.subject ? vapid : null;
  }
}
