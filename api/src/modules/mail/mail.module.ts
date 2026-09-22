import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MailerModule } from '@nestjs-modules/mailer';
import { MailService } from './mail.service';

// Global: cualquier módulo puede inyectar MailService sin importar MailModule.
// Variables de entorno: SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, MAIL_FROM.
// Sin SMTP_HOST se usa un transporte JSON (no envía nada) para poder desarrollar sin servidor de correo.
@Global()
@Module({
  imports: [
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const user = config.get<string>('SMTP_USER');
        const pass = config.get<string>('SMTP_PASS');
        // Gmail por defecto (465 + SSL); se puede sobreescribir con SMTP_HOST / SMTP_PORT / SMTP_SECURE
        const host = config.get<string>('SMTP_HOST') || (user ? 'smtp.gmail.com' : undefined);
        const port = Number(config.get<string>('SMTP_PORT') || 465);
        const secure = config.get<string>('SMTP_SECURE') ? config.get<string>('SMTP_SECURE') === 'true' : port === 465;

        return {
          transport: host ? { host, port, secure, auth: user ? { user, pass } : undefined } : { jsonTransport: true },
          defaults: {
            from: config.get<string>('MAIL_FROM') ?? '"Stella Femme" <no-reply@stellafemme.com>',
          },
        };
      },
    }),
  ],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
