import { Global, Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MailerModule } from '@nestjs-modules/mailer';
import { MailService } from './mail.service';

type EnvReader = { get<T = string>(key: string): T | undefined };

/**
 * Transporte de la ÚNICA cuenta SMTP de la plataforma: la usan todas las tiendas (facturas, bienvenida,
 * recuperación) y los correos de NovaSoft. No hay cuentas ni contraseñas de correo por tienda.
 * Variables: SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, MAIL_FROM.
 * Sin servidor se usa un transporte JSON (no envía nada) para poder desarrollar sin correo.
 */
export function resolveMailTransport(config: EnvReader, logger: Pick<Logger, 'error'> = new Logger('MailModule')) {
  const user = config.get<string>('SMTP_USER')?.trim();
  const pass = config.get<string>('SMTP_PASS');
  // SMTP_HOST es el SERVIDOR (smtp.gmail.com), no una dirección de correo. Con una dirección ahí cada
  // envío falla por DNS (EAI_FAIL) y ningún correo sale: se avisa claramente y se ignora ese valor.
  let configuredHost = config.get<string>('SMTP_HOST')?.trim();
  if (configuredHost && (configuredHost.includes('@') || /\s/.test(configuredHost))) {
    logger.error(
      'SMTP_HOST contiene una dirección de correo o espacios, no un servidor SMTP. Usa por ejemplo SMTP_HOST=smtp.gmail.com (la cuenta va en SMTP_USER). Se ignora el valor.',
    );
    configuredHost = undefined;
  }
  // Gmail por defecto (465 + SSL); se puede sobreescribir con SMTP_HOST / SMTP_PORT / SMTP_SECURE
  const host = configuredHost || (user ? 'smtp.gmail.com' : undefined);
  const port = Number(config.get<string>('SMTP_PORT') || 465);
  const secure = config.get<string>('SMTP_SECURE') ? config.get<string>('SMTP_SECURE') === 'true' : port === 465;

  return {
    transport: host ? { host, port, secure, auth: user ? { user, pass } : undefined } : { jsonTransport: true as const },
    defaults: {
      from: config.get<string>('MAIL_FROM') ?? '"NovaSoft" <no-reply@novasoft.com>',
    },
  };
}

// Global: cualquier módulo puede inyectar MailService sin importar MailModule.
@Global()
@Module({
  imports: [
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => resolveMailTransport(config),
    }),
  ],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
