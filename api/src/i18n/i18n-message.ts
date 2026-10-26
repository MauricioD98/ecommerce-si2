// Idiomas de la API. Mismos que el front (front/i18n/config.ts) y la app (app_movil/src/i18n).
// Los diccionarios viven en src/i18n/<idioma>/{errors,validation}.json (nest-cli.json los copia a dist).
export const LANGUAGES = ['es', 'en', 'fr', 'zh'] as const;
export type Language = (typeof LANGUAGES)[number];
export const FALLBACK_LANGUAGE: Language = 'es';

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

// Un mensaje traducible es una clave, opcionalmente con argumentos en JSON tras "|":
//   "errors.PRODUCT_NOT_FOUND"
//   "errors.SKU_TAKEN|{\"sku\":\"WH-001\"}"
// Va como texto plano dentro de la excepción (new NotFoundException(i18nMessage(...))) y lo traduce
// I18nExceptionFilter al idioma del request. Es el mismo formato que usa nestjs-i18n.
const KEY_PATTERN = /^(errors|validation)\.[A-Za-z0-9_.]+$/;

export function i18nMessage(key: `errors.${string}` | `validation.${string}`, args?: Record<string, unknown>): string {
  return args ? `${key}|${JSON.stringify(args)}` : key;
}

/** null si el texto no es una clave traducible (mensaje libre de antes de migrar a i18n) */
export function parseI18nMessage(message: string): { key: string; args: Record<string, unknown> } | null {
  const separator = message.indexOf('|');
  const key = separator === -1 ? message : message.slice(0, separator);
  if (!KEY_PATTERN.test(key)) return null;
  if (separator === -1) return { key, args: {} };
  try {
    const args = JSON.parse(message.slice(separator + 1));
    return { key, args: args && typeof args === 'object' ? args : {} };
  } catch {
    return { key, args: {} };
  }
}
