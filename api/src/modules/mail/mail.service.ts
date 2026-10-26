import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ISendMailOptions, MailerService } from '@nestjs-modules/mailer';
import { campaignEmail, contactEmail, invoiceEmail, resetPasswordEmail, tenantWelcomeEmail, welcomeEmail } from './mail.templates';
import { withTenantParam } from '../../tenancy/tenant-context';

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
  ) {}

  // Lleva ?tenant=<id>: quien abre el link desde el correo puede no tener la tienda guardada en ese
  // navegador (otro dispositivo, otro cliente de correo) y sin ella el front no puede llamar a la API.
  private get frontendUrl(): string {
    return withTenantParam(this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000');
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

  sendWelcome(to: string, firstName?: string | null): Promise<boolean> {
    return this.send({
      to,
      subject: '¡Bienvenido a Stella Femme!',
      html: welcomeEmail(firstName || 'cliente', this.frontendUrl),
    });
  }

  // `otp` es el código de 6 dígitos (solo viaja en el correo)
  sendPasswordReset(to: string, firstName: string | null | undefined, otp: string): Promise<boolean> {
    // Sin SMTP el correo no sale: en desarrollo el código se muestra en el log para poder probar el flujo
    if (!this.config.get<string>('SMTP_HOST') && !this.config.get<string>('SMTP_USER') && process.env.NODE_ENV !== 'production') {
      this.logger.warn(`[DEV] Código de recuperación para ${to}: ${otp}`);
    }
    return this.send({
      to,
      subject: 'Tu código para restablecer la contraseña de Stella Femme',
      html: resetPasswordEmail(firstName || 'cliente', otp),
    });
  }

  sendTenantWelcome(params: {
    to: string;
    tenantName: string;
    loginUrl: string;
    domain?: string | null;
  }): Promise<boolean> {
    const platformHost = new URL(this.config.get<string>('PLATFORM_URL') ?? this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000').host;
    return this.send({
      to: params.to,
      subject: `Tu tienda ${params.tenantName} está lista`,
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
      replyTo: { name: params.name, address: params.email },
      // Sin saltos de línea en el asunto: evita inyección de headers con un nombre manipulado
      subject: `Contacto: ${params.name.replace(/[\r\n]+/g, ' ').slice(0, 80)}`,
      html: contactEmail(params),
    });
  }

  sendInvoice(params: {
    to: string;
    firstName?: string | null;
    orderNumber: string;
    total: number;
    pdf: Buffer;
    filename: string;
  }): Promise<boolean> {
    return this.send({
      to: params.to,
      subject: `Tu factura del pedido #${params.orderNumber}`,
      html: invoiceEmail(params.firstName || 'cliente', params.orderNumber, `Bs ${params.total.toFixed(2)}`),
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
    const html = this.tagStoreLinks(campaignEmail(subject, htmlBody));
    let sent = 0;
    let failed = 0;

    for (let i = 0; i < recipients.length; i += this.CAMPAIGN_BATCH_SIZE) {
      const batch = recipients.slice(i, i + this.CAMPAIGN_BATCH_SIZE);
      const results = await Promise.all(batch.map((recipient) => this.send({ to: recipient.email, subject, html })));
      sent += results.filter(Boolean).length;
      failed += results.filter((ok) => !ok).length;
    }

    return { sent, failed };
  }
}
