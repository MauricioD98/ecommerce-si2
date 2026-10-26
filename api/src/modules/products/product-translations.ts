import { registerDecorator, type ValidationOptions } from 'class-validator';
import { I18nContext } from 'nestjs-i18n';
import { FALLBACK_LANGUAGE, i18nMessage, isLanguage, type Language } from '../../i18n/i18n-message';

// Traducciones del catálogo guardadas en products.translations (JSONB). El español no va acá: es el
// texto base de name/description, el que usan búsqueda, reportes, POS y pedidos.
export const TRANSLATABLE_LANGUAGES = ['en', 'fr', 'zh'] as const satisfies readonly Language[];
export type TranslatableLanguage = (typeof TRANSLATABLE_LANGUAGES)[number];

export interface ProductTranslation {
  name?: string;
  description?: string | null;
}

export type ProductTranslations = Partial<Record<TranslatableLanguage, ProductTranslation>>;

const NAME_MAX = 200;
const DESCRIPTION_MAX = 5000;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Valida { en?: { name?, description? }, fr?: ..., pt?: ..., zh?: ... }. Rechaza idiomas fuera de la
 * lista y campos extra: el JSONB no tiene esquema en la base, así que esta es la única barrera.
 */
export function IsProductTranslations(options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isProductTranslations',
      target: target.constructor,
      propertyName,
      options: { message: i18nMessage('validation.TRANSLATIONS_INVALID'), ...options },
      validator: {
        validate(value: unknown) {
          if (!isPlainObject(value)) return false;
          return Object.entries(value).every(([language, entry]) => {
            if (!(TRANSLATABLE_LANGUAGES as readonly string[]).includes(language) || !isPlainObject(entry)) return false;
            const { name, description, ...extra } = entry;
            return (
              Object.keys(extra).length === 0 &&
              (name === undefined || (typeof name === 'string' && name.length <= NAME_MAX)) &&
              (description === undefined ||
                description === null ||
                (typeof description === 'string' && description.length <= DESCRIPTION_MAX))
            );
          });
        },
      },
    });
}

/** Recorta espacios y descarta lo vacío: un "" no debe tapar el texto base al resolver el idioma. */
export function normalizeTranslations(input: ProductTranslations): ProductTranslations {
  const result: ProductTranslations = {};
  for (const language of TRANSLATABLE_LANGUAGES) {
    const name = input[language]?.name?.trim();
    const description = input[language]?.description?.trim();
    if (name || description) result[language] = { ...(name ? { name } : {}), ...(description ? { description } : {}) };
  }
  return result;
}

/** Lo que viene de la columna JSONB (Prisma lo tipa como JsonValue) */
export function readTranslations(value: unknown): ProductTranslations {
  return isPlainObject(value) ? normalizeTranslations(value as ProductTranslations) : {};
}

/** Idioma del request actual (lo resuelve nestjs-i18n desde Accept-Language / x-lang / ?lang). */
export function currentLanguage(): Language {
  const lang = I18nContext.current()?.lang;
  return isLanguage(lang) ? lang : FALLBACK_LANGUAGE;
}

/**
 * Fila de Product (tal como la devuelve Prisma en un include) lista para el cliente: name y
 * description en el idioma del request, más el texto base en baseName/baseDescription. La usan
 * Carrito, Pedidos y POS, que no pasan por ProductsService.formatProduct.
 */
export function localizeProductRow<T extends { name: string; description: string | null; translations: unknown }>(
  product: T,
  language: Language = currentLanguage(),
): T & { baseName: string; baseDescription: string | null; locale: Language } {
  const localized = localizeProduct(product, readTranslations(product.translations), language);
  return {
    ...product,
    ...localized,
    baseName: product.name,
    baseDescription: product.description,
    locale: language,
  };
}

/** Solo el nombre traducido (pedidos y tickets del POS exponen productName, no el producto entero). */
export function localizedProductName(
  product: { name: string; translations: unknown },
  language: Language = currentLanguage(),
): string {
  return localizeProduct({ name: product.name, description: null }, readTranslations(product.translations), language).name;
}

/** name/description en el idioma pedido; lo que falte en ese idioma cae al texto base (español). */
export function localizeProduct(
  base: { name: string; description: string | null },
  translations: ProductTranslations,
  language: Language,
): { name: string; description: string | null } {
  if (language === FALLBACK_LANGUAGE) return base;
  const translated = translations[language as TranslatableLanguage];
  return {
    name: translated?.name || base.name,
    description: translated?.description || base.description,
  };
}
