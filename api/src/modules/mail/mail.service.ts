import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ISendMailOptions, MailerService } from '@nestjs-modules/mailer';
import {
  campaignEmail,
  contactEmail,
  invoiceEmail,
  platformBrand,
  resetPasswordEmail,
  tenantWelcomeEmail,
  welcomeEmail,
} from './mail.templates';
import { tenantStorage, withTenantParam } from '../../tenancy/tenant-context';
import { ControlPrismaService } from '../../tenancy/control-prisma.service';

export interface CampaignRecipient {
  email: string;
}

// Envío de correos. Ningún método lanza error: un fallo de SMTP no debe romper el registro, el pago ni
// la recuperación de contraseña; se registra en el log y se devuelve false.
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  // Cuántos correos de una campaña se envían en paralelo
  private readonly CAMPAIGN_BATCH_SIZE = 10;

  constructor(
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
    private readonly control: ControlPrismaService,
  ) {}

  // Lleva ?tenant=<id>: quien abre el link desde el correo puede no tener la tienda guardada en ese
  // navegador (otro dispositivo, otro cliente de correo) y sin ella el front no puede llamar a la API.
  private get frontendUrl(): string {
    return withTenantParam(this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000');
  }

  // Sin tienda identificable se usa la marca de la plataforma, nunca el nombre de otra tienda
  private async currentStoreName(): Promise<string> {
    const tenantId = tenantStorage.getStore()?.tenantId;
    if (!tenantId) return platformBrand();
    try {
      const tenant = await this.control.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true },
      });
      return tenant?.name?.trim() || platformBrand();
    } catch {
      return platformBrand();
    }
  }

  // Dirección autorizada para enviar: la cuenta SMTP o, si no hay usuario SMTP, la de MAIL_FROM.
  // Nunca se usa una dirección de la tienda: el SMTP de la plataforma no está autorizado a enviar por ella.
  private authorizedSenderAddress(): string | undefined {
    const smtpUser = this.config.get<string>('SMTP_USER')?.trim();
    if (smtpUser) return smtpUser;
    const mailFrom = this.config.get<string>('MAIL_FROM')?.trim();
    if (!mailFrom) return undefined;
    const match = /<([^<>\s]+@[^<>\s]+)>/.exec(mailFrom);
    if (match) return match[1];
    return /^[^\s<>"]+@[^\s<>"]+$/.test(mailFrom) ? mailFrom : undefined;
  }

  // "Tienda vía NovaSoft" <dirección autorizada>: el cliente ve la tienda y el envío sigue saliendo por
  // la cuenta de la plataforma. Sin dirección conocida se deja el remitente por defecto del mailer.
  private storeViaPlatformFrom(storeName: string): string | undefined {
    const address = this.authorizedSenderAddress();
    if (!address) return undefined;
    const display = `${storeName} vía ${platformBrand()}`.replace(/["\\\r\n]+/g, ' ').trim();
    return `"${display}" <${address}>`;
  }

  private storeFromHeader(brandName: string): string | undefined {
    const smtpUser = this.config.get<string>('SMTP_USER');
    if (!smtpUser) return undefined;
    const safeBrand = brandName.replace(/["\r\n]+/g, ' ').trim();
    return `"${safeBrand}" <${smtpUser}>`;
  }

  private async send(options: ISendMailOptions): Promise<boolean> {
    try {
      await this.mailer.sendMail(options);
      if (!this.config.get<string>('SMTP_HOST') && !this.config.get<string>('SMTP_USER')) {
        // Modo desarrollo sin SMTP configurado: el correo no sale, solo se registra
        this.logger.log(`[SMTP no configurado] Correo simulado a ${String(options.to)}: "${options.subject}"`);
      }
      return true;
    } catch (error) {
      this.logger.error(
        `No se pudo enviar el correo a ${String(options.to)}: ${error instanceof Error ? error.message : error}`,
      );
      return false;
    }
  }

  async sendWelcome(to: string, firstName?: string | null): Promise<boolean> {
    const storeName = await this.currentStoreName();
    return this.send({
      to,
      from: this.storeFromHeader(storeName),
      subject: `¡Bienvenido a ${storeName}!`,
      html: welcomeEmail(firstName || 'cliente', this.frontendUrl, storeName),
    });
  }

  // `otp` es el código de 6 dígitos (solo viaja en el correo)
  async sendPasswordReset(to: string, firstName: string | null | undefined, otp: string): Promise<boolean> {
    // Sin SMTP el correo no sale: en desarrollo el código se muestra en el log para poder probar el flujo
    if (!this.config.get<string>('SMTP_HOST') && !this.config.get<string>('SMTP_USER') && process.env.NODE_ENV !== 'production') {
      this.logger.warn(`[DEV] Código de recuperación para ${to}: ${otp}`);
    }
    const storeName = await this.currentStoreName();
    return this.send({
      to,
      from: this.storeFromHeader(storeName),
      subject: `Tu código para restablecer la contraseña de ${storeName}`,
      html: resetPasswordEmail(firstName || 'cliente', otp, storeName),
    });
  }

  sendTenantWelcome(params: {
    to: string;
    tenantName: string;
    loginUrl: string;
    domain?: string | null;
  }): Promise<boolean> {
    const platformHost = new URL(
      this.config.get<string>('PLATFORM_URL') ?? this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000',
    ).host;
    return this.send({
      to: params.to,
      from: this.storeFromHeader(platformBrand()),
      subject: `Tu tienda ${params.tenantName} está lista en ${platformBrand()}`,
      html: tenantWelcomeEmail({ ...params, adminEmail: params.to, platformHost }),
    });
  }

  // A la bandeja de soporte del SaaS. replyTo = el visitante, así el equipo responde directo.
  // Devuelve false (no lanza) si SUPPORT_EMAIL no está configurado o el SMTP falla.
  sendContactMessage(params: { name: string; email: string; message: string; ip?: string }): Promise<boolean> {
    const to = this.config.get<string>('SUPPORT_EMAIL');
    if (!to) {
      this.logger.error('SUPPORT_EMAIL no configurado: no se puede reenviar el formulario de contacto');
      return Promise.resolve(false);
    }
    return this.send({
      to,
      from: this.storeFromHeader(platformBrand()),
      replyTo: { name: params.name, address: params.email },
      // Sin saltos de línea en el asunto: evita inyección de headers con un nombre manipulado
      subject: `[${platformBrand()}] Contacto: ${params.name.replace(/[\r\n]+/g, ' ').slice(0, 80)}`,
      html: contactEmail(params),
    });
  }

  // storeName lo resuelve InvoiceService en el backend a partir del tenant del pedido: acá no se
  // vuelve a adivinar (ni se cae a un nombre por defecto) para no mezclar tiendas.
  async sendInvoice(params: {
    to: string;
    firstName?: string | null;
    storeName: string;
    orderNumber: string;
    total: number;
    pdf: Buffer;
    filename: string;
  }): Promise<boolean> {
    const storeName = params.storeName.replace(/[\r\n]+/g, ' ').trim();
    if (!storeName) {
      // No debería pasar (InvoiceService no emite sin tienda), pero sin nombre no se envía con otro
      this.logger.error(`Factura del pedido #${params.orderNumber} sin nombre de tienda: no se envía`);
      return false;
    }
    return this.send({
      to: params.to,
      from: this.storeViaPlatformFrom(storeName),
      subject: `Tu factura de ${storeName} - pedido #${params.orderNumber}`,
      html: invoiceEmail(params.firstName || 'cliente', params.orderNumber, `Bs ${params.total.toFixed(2)}`, storeName),
      attachments: [{ filename: params.filename, content: params.pdf, contentType: 'application/pdf' }],
    });
  }

  // El HTML de una campaña lo escribe el equipo de marketing: los links que apuntan a la tienda
  // (mismo origen que FRONTEND_URL) reciben ?tenant=; los externos quedan como están.
  private tagStoreLinks(html: string): string {
    const base = this.config.get<string>('FRONTEND_URL');
    if (!base) return html;
    const storeOrigin = new URL(base).origin;
    return html.replace(/href\s*=\s*("|')([^"']+)\1/gi, (match, quote: string, href: string) => {
      try {
        return new URL(href).origin === storeOrigin ? `href=${quote}${withTenantParam(href)}${quote}` : match;
      } catch {
        return match; // mailto:, anclas, URLs relativas: no se tocan
      }
    });
  }

  // Un correo individual por destinatario (así nadie ve las direcciones de los demás)
  async sendCampaign(
    recipients: CampaignRecipient[],
    subject: string,
    htmlBody: string,
  ): Promise<{ sent: number; failed: number }> {
    const storeName = await this.currentStoreName();
    const from = this.storeFromHeader(storeName);
    const html = this.tagStoreLinks(campaignEmail(subject, htmlBody, storeName));
    let sent = 0;
    let failed = 0;

    for (let i = 0; i < recipients.length; i += this.CAMPAIGN_BATCH_SIZE) {
      const batch = recipients.slice(i, i + this.CAMPAIGN_BATCH_SIZE);
      const results = await Promise.all(
        batch.map((recipient) => this.send({ to: recipient.email, from, subject, html })),
      );
      sent += results.filter(Boolean).length;
      failed += results.filter((ok) => !ok).length;
    }

    return { sent, failed };
  }
}
