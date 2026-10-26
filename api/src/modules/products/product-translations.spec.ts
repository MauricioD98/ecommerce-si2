import { I18nContext } from 'nestjs-i18n';
import { localizeProductRow, localizedProductName, normalizeTranslations } from './product-translations';

// Fila de Product como llega en los include de Carrito, Pedidos y POS
const row = {
  id: 'prod-1',
  name: 'Vestido largo rojo',
  description: 'Satén',
  translations: { en: { name: 'Long red dress' }, fr: { name: 'Robe longue rouge', description: 'Satin' } },
  price: 199.9,
};

describe('product-translations', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('localizeProductRow (Carrito)', () => {
    it('reemplaza name/description y conserva el resto de la fila', () => {
      const result = localizeProductRow(row, 'fr');

      expect(result).toMatchObject({
        id: 'prod-1',
        price: 199.9,
        name: 'Robe longue rouge',
        description: 'Satin',
        baseName: 'Vestido largo rojo',
        baseDescription: 'Satén',
        locale: 'fr',
      });
    });

    it('cada campo faltante cae al español', () => {
      expect(localizeProductRow(row, 'en')).toMatchObject({ name: 'Long red dress', description: 'Satén' });
    });

    it('toma el idioma del request cuando no se le pasa uno', () => {
      jest.spyOn(I18nContext, 'current').mockReturnValue({ lang: 'en' } as unknown as I18nContext);

      expect(localizeProductRow(row).name).toBe('Long red dress');
    });
  });

  describe('localizedProductName (Pedidos y POS)', () => {
    it('devuelve el nombre traducido', () => {
      expect(localizedProductName(row, 'en')).toBe('Long red dress');
    });

    it('sin traducción para ese idioma devuelve el nombre base', () => {
      expect(localizedProductName(row, 'zh')).toBe('Vestido largo rojo');
    });

    it('con JSONB vacío o inválido devuelve el nombre base', () => {
      expect(localizedProductName({ name: 'Blusa', translations: {} }, 'fr')).toBe('Blusa');
      expect(localizedProductName({ name: 'Blusa', translations: 'roto' }, 'fr')).toBe('Blusa');
    });
  });

  describe('normalizeTranslations', () => {
    it('descarta idiomas no soportados y valores vacíos', () => {
      const input = { en: { name: ' Dress ' }, fr: { name: '' }, es: { name: 'Vestido' } } as never;

      expect(normalizeTranslations(input)).toEqual({ en: { name: 'Dress' } });
    });
  });
});
