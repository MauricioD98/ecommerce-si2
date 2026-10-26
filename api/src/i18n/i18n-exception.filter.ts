import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import type { Request, Response } from 'express';
import { I18nContext, I18nService } from 'nestjs-i18n';
import { FALLBACK_LANGUAGE, isLanguage, parseI18nMessage, type Language } from './i18n-message';

/**
 * Lo lanza el ValidationPipe global (main.ts → exceptionFactory) con los errores crudos de
 * class-validator, para que el filtro los traduzca con el idioma del request.
 */
export class ValidationFailedException extends BadRequestException {
  constructor(readonly errors: ValidationError[]) {
    super('Validation failed');
  }
}

// Mensajes por defecto de Nest/Throttler que el cliente ve tal cual: se reemplazan por el genérico
// del status en el idioma del request. Cualquier otro texto libre se deja como está.
const NEST_DEFAULT_MESSAGES = new Set([
  'Bad Request',
  'Unauthorized',
  'Forbidden',
  'Forbidden resource',
  'Not Found',
  'Conflict',
  'Too Many Requests',
  'ThrottlerException: Too Many Requests',
  'Internal Server Error',
  'Internal server error',
  'Service Unavailable',
]);

// Restricciones cuyo mensaje genérico necesita los números de la regla (MinLength(8) → {min: 8})
const MIN_CONSTRAINTS = new Set(['minLength', 'min', 'arrayMinSize']);
const MAX_CONSTRAINTS = new Set(['maxLength', 'max', 'arrayMaxSize']);

/**
 * Traduce el `message` de toda HttpException según el idioma del request (Accept-Language, x-lang o
 * ?lang=, resuelto por nestjs-i18n). El resto del cuerpo se conserva: el front lee `message` (texto o
 * lista) y algunos endpoints agregan campos como `code: "TENANT_REQUIRED"`.
 *
 *   - "errors.X" / "validation.X" (ver i18nMessage)  → se traduce, con sus argumentos
 *   - mensajes por defecto de Nest ("Forbidden resource") → genérico del status
 *   - texto libre (mensajes en español de antes de migrar a claves) → sin cambios
 */
@Catch(HttpException)
export class I18nExceptionFilter implements ExceptionFilter {
  constructor(private readonly i18n: I18nService) {}

  catch(exception: HttpException, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const status = exception.getStatus();
    const lang = this.languageOf(host, http.getRequest<Request>());

    const raw = exception.getResponse();
    const body: Record<string, unknown> =
      typeof raw === 'string' ? { statusCode: status, message: raw } : { statusCode: status, ...(raw as object) };

    if (exception instanceof ValidationFailedException) {
      body.message = this.validationMessages(exception.errors, lang);
      body.error = this.statusMessage(status, lang);
    } else if (Array.isArray(body.message)) {
      body.message = body.message.map((m) => (typeof m === 'string' ? this.translateMessage(m, status, lang) : m));
    } else if (typeof body.message === 'string') {
      body.message = this.translateMessage(body.message, status, lang);
    }

    response.status(status).json(body);
  }

  // nestjs-i18n deja el idioma en el contexto del request. Si la excepción salió antes de que se
  // armara (p. ej. en TenantMiddleware), se lee Accept-Language a mano.
  private languageOf(host: ArgumentsHost, request: Request): Language {
    const fromContext = I18nContext.current(host)?.lang;
    if (isLanguage(fromContext)) return fromContext;
    const header = request.headers?.['accept-language'];
    const first = typeof header === 'string' ? header.split(',')[0]?.trim().toLowerCase().split('-')[0] : undefined;
    return isLanguage(first) ? first : FALLBACK_LANGUAGE;
  }

  private translateMessage(message: string, status: number, lang: Language): string {
    const parsed = parseI18nMessage(message);
    if (parsed) return this.translate(parsed.key, parsed.args, lang) ?? message;
    if (NEST_DEFAULT_MESSAGES.has(message)) return this.statusMessage(status, lang);
    return message;
  }

  private statusMessage(status: number, lang: Language): string {
    return this.translate(`errors.status.${status}`, {}, lang) ?? this.translate('errors.status.400', {}, lang) ?? 'Error';
  }

  /** null si la clave no existe en ningún idioma (así se muestra el texto original, no la clave) */
  private translate(key: string, args: Record<string, unknown>, lang: Language): string | null {
    const value: unknown = this.i18n.translate(key, { lang, args });
    if (typeof value === 'string') return value === key ? null : value;

    // Plurales ({ one, other }): se elige la forma con Intl.PluralRules del idioma
    if (value && typeof value === 'object') {
      const forms = value as Record<string, unknown>;
      const count = Number(args.count ?? 0);
      const form = forms[new Intl.PluralRules(lang).select(count)] ?? forms.other;
      if (typeof form === 'string') return form.replace(/\{(\w+)\}/g, (match, name) => (name in args ? String(args[name]) : match));
    }
    return null;
  }

  private validationMessages(errors: ValidationError[], lang: Language, parent = ''): string[] {
    return errors.flatMap((error) => {
      const property = parent ? `${parent}.${error.property}` : error.property;
      const own = Object.entries(error.constraints ?? {}).map(([constraint, message]) =>
        this.validationMessage(constraint, message, property, error.property, lang),
      );
      return [...own, ...this.validationMessages(error.children ?? [], lang, property)];
    });
  }

  private validationMessage(constraint: string, message: string, property: string, ownProperty: string, lang: Language): string {
    // 1. El DTO usó una clave: @Matches(..., { message: i18nMessage('validation.PASSWORD_STRONG') })
    const parsed = parseI18nMessage(message);
    if (parsed) return this.translate(parsed.key, { property, ...parsed.args }, lang) ?? message;

    // 2. Mensaje personalizado en español de un DTO todavía sin migrar: en español se conserva (es
    //    más específico que el genérico); en otro idioma se usa el genérico traducido. Los mensajes
    //    por defecto de class-validator siempre empiezan con el nombre del campo, los propios no.
    const isDefault = message.startsWith(`${ownProperty} `) || message.startsWith('each value in ');
    if (!isDefault && lang === 'es') return message;

    const numbers = message.match(/-?\d+(?:\.\d+)?/g) ?? [];
    const args: Record<string, unknown> = { property };
    if (MIN_CONSTRAINTS.has(constraint)) args.min = numbers[0];
    if (MAX_CONSTRAINTS.has(constraint)) args.max = numbers[0];
    if (constraint === 'isLength') Object.assign(args, { min: numbers[0], max: numbers[1] ?? numbers[0] });

    return this.translate(`validation.${constraint}`, args, lang) ?? message;
  }
}
