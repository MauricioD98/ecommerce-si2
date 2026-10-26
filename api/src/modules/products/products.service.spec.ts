import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { I18nContext } from 'nestjs-i18n';
import { ProductsService } from './products.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../branches/inventory.service';
import { SUPER_ADMIN_ROLE } from '../../common/constants/permissions';
import type { AuthUser } from '../../common/decorators/interfaces/request-with-user.interface';
import { WomenSize } from './dto/create-product.dto';

// Fila de Product tal como la devuelve Prisma con el include de ProductsService (category,
// collections y _count). `translations` es la columna JSONB: { en: { name, description }, ... }.
const productRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'prod-1',
  name: 'Vestido largo rojo',
  description: 'Satén, largo hasta el piso',
  translations: {
    en: { name: 'Long red dress', description: 'Satin, floor length' },
    fr: { name: 'Robe longue rouge' }, // sin descripción: debe caer al texto base
  },
  sizes: ['S', 'M'],
  colors: ['rojo'],
  price: new Prisma.Decimal('199.90'),
  stock: 20,
  sku: 'VES-001',
  imageUrl: null,
  isActive: true,
  categoryId: 'cat-1',
  branchId: null,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
  category: { id: 'cat-1', name: 'Vestidos', slug: 'vestidos' },
  collections: [],
  _count: { orderItems: 0 },
  ...overrides,
});

const superAdmin: AuthUser = {
  id: 'user-1',
  email: 'admin@tienda.com',
  role: { id: 'role-1', name: SUPER_ADMIN_ROLE, permissions: [] },
  branchId: null,
  tenantId: 'tenant-1',
};

// Simula el idioma que nestjs-i18n resuelve desde Accept-Language
const useLanguage = (lang: string | undefined) =>
  jest
    .spyOn(I18nContext, 'current')
    .mockReturnValue((lang ? { lang } : undefined) as unknown as I18nContext);

describe('ProductsService', () => {
  let service: ProductsService;
  const prisma = {
    product: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    category: { findUnique: jest.fn() },
    branch: { findMany: jest.fn() },
    productInventory: { createMany: jest.fn() },
  };
  const inventoryService = {
    getInventory: jest.fn(),
    getInventoryMap: jest.fn(),
    applyDiscountToAllBranches: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    useLanguage('es');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: prisma },
        { provide: InventoryService, useValue: inventoryService },
      ],
    }).compile();

    service = module.get(ProductsService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findOne: traducción según Accept-Language', () => {
    beforeEach(() => prisma.product.findUnique.mockResolvedValue(productRow()));

    it('en español devuelve el texto base', async () => {
      const result = await service.findOne('prod-1');

      expect(result.name).toBe('Vestido largo rojo');
      expect(result.description).toBe('Satén, largo hasta el piso');
      expect(result.locale).toBe('es');
    });

    it('en inglés devuelve name y description traducidos', async () => {
      useLanguage('en');
      const result = await service.findOne('prod-1');

      expect(result.name).toBe('Long red dress');
      expect(result.description).toBe('Satin, floor length');
      expect(result.locale).toBe('en');
    });

    it('si falta un campo en el idioma pedido, ese campo cae al español', async () => {
      useLanguage('fr');
      const result = await service.findOne('prod-1');

      expect(result.name).toBe('Robe longue rouge');
      expect(result.description).toBe('Satén, largo hasta el piso');
    });

    it('un idioma sin traducción devuelve todo en español', async () => {
      useLanguage('zh');
      const result = await service.findOne('prod-1');

      expect(result.name).toBe('Vestido largo rojo');
    });

    it('sin contexto de i18n (fuera de un request) usa español', async () => {
      useLanguage(undefined);
      const result = await service.findOne('prod-1');

      expect(result.name).toBe('Vestido largo rojo');
      expect(result.locale).toBe('es');
    });

    it('siempre expone el texto base y las traducciones para el formulario del admin', async () => {
      useLanguage('en');
      const result = await service.findOne('prod-1');

      expect(result.baseName).toBe('Vestido largo rojo');
      expect(result.baseDescription).toBe('Satén, largo hasta el piso');
      expect(result.translations).toEqual({
        en: { name: 'Long red dress', description: 'Satin, floor length' },
        fr: { name: 'Robe longue rouge' },
      });
    });

    it('tolera filas viejas cuyo JSONB no es un objeto', async () => {
      prisma.product.findUnique.mockResolvedValue(productRow({ translations: null }));
      useLanguage('en');
      const result = await service.findOne('prod-1');

      expect(result.name).toBe('Vestido largo rojo');
      expect(result.translations).toEqual({});
    });

    it('lanza la clave traducible si el producto no existe', async () => {
      prisma.product.findUnique.mockResolvedValue(null);

      await expect(service.findOne('nope')).rejects.toThrow(new NotFoundException('errors.PRODUCT_NOT_FOUND'));
    });
  });

  describe('findAll', () => {
    beforeEach(() => {
      prisma.product.count.mockResolvedValue(1);
      prisma.product.findMany.mockResolvedValue([productRow()]);
    });

    it('traduce cada producto de la lista', async () => {
      useLanguage('en');
      const { data } = await service.findAll({ page: 1, limit: 10 });

      expect(data.map((p) => p.name)).toEqual(['Long red dress']);
    });

    it('en otro idioma la búsqueda también mira la traducción de ese idioma', async () => {
      useLanguage('en');
      await service.findAll({ page: 1, limit: 10, search: 'dress' });

      const { where } = prisma.product.count.mock.calls[0][0];
      expect(where.OR).toEqual(
        expect.arrayContaining([
          { name: { contains: 'dress', mode: 'insensitive' } },
          { translations: { path: ['en', 'name'], string_contains: 'dress' } },
          { translations: { path: ['en', 'description'], string_contains: 'dress' } },
        ]),
      );
    });

    it('en español la búsqueda no consulta el JSONB', async () => {
      await service.findAll({ page: 1, limit: 10, search: 'vestido' });

      const { where } = prisma.product.count.mock.calls[0][0];
      expect(where.OR).toHaveLength(2);
    });
  });

  describe('create / update: guardado de translations', () => {
    const baseDto = {
      name: 'Vestido largo rojo',
      sizes: [WomenSize.S],
      price: 199.9,
      sku: 'VES-001',
      categoryId: 'cat-1',
    };

    beforeEach(() => {
      prisma.product.findUnique.mockResolvedValue(null); // SKU libre
      prisma.category.findUnique.mockResolvedValue({ id: 'cat-1' });
      prisma.product.create.mockResolvedValue(productRow({ sizes: [] }));
      prisma.branch.findMany.mockResolvedValue([]);
    });

    it('recorta espacios y descarta idiomas vacíos antes de guardar', async () => {
      await service.create(
        {
          ...baseDto,
          translations: {
            en: { name: '  Long red dress  ', description: '' },
            fr: { name: '   ' },
          },
        },
        superAdmin,
      );

      expect(prisma.product.create.mock.calls[0][0].data.translations).toEqual({ en: { name: 'Long red dress' } });
    });

    it('sin translations guarda un objeto vacío', async () => {
      await service.create(baseDto, superAdmin);

      expect(prisma.product.create.mock.calls[0][0].data.translations).toEqual({});
    });

    it('rechaza un SKU repetido con la clave traducible y sus argumentos', async () => {
      prisma.product.findUnique.mockResolvedValue(productRow());

      await expect(service.create(baseDto, superAdmin)).rejects.toThrow(
        new ConflictException('errors.SKU_TAKEN|{"sku":"VES-001"}'),
      );
    });

    it('al actualizar reemplaza las traducciones completas', async () => {
      prisma.product.findUnique.mockResolvedValue(productRow());
      prisma.product.update.mockResolvedValue(productRow());

      await service.update('prod-1', { translations: { zh: { name: '红色长裙' } } }, superAdmin);

      expect(prisma.product.update.mock.calls[0][0].data.translations).toEqual({ zh: { name: '红色长裙' } });
    });

    it('al actualizar sin translations no toca la columna', async () => {
      prisma.product.findUnique.mockResolvedValue(productRow());
      prisma.product.update.mockResolvedValue(productRow());

      await service.update('prod-1', { price: 150 }, superAdmin);

      expect(prisma.product.update.mock.calls[0][0].data).not.toHaveProperty('translations');
    });
  });
});
