import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { getBranchPrice } from '../../common/utils/pricing';
import { ChatbotCatalogDto, ChatbotProductDto } from './dto/chatbot-product-response.dto';
import { QueryChatbotProductsDto } from './dto/query-chatbot-products.dto';

// Catálogo aplanado para el chatbot (Botpress). Es una vista de solo lectura del mismo dato que ve
// la tienda, pero sin paginación anidada ni campos de admin: el bot necesita poder decir "sí, hay
// talla M, cuesta Bs 315" en un solo salto.
//
// Sobre el stock: Product.stock es legado (ver schema.prisma). El stock real vive en
// ProductInventory por producto+sucursal+talla, así que se agrega desde ahí. Sin branchId se suman
// todas las sucursales (el cliente todavía no dijo dónde compra); con branchId es el de esa tienda.

const DEFAULT_LIMIT = 20;

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);

  constructor(private prisma: PrismaService) {}

  async getCatalog(queryDto: QueryChatbotProductsDto): Promise<ChatbotCatalogDto> {
    const { search, branchId, inStockOnly, limit = DEFAULT_LIMIT } = queryDto;

    // Solo productos publicados: un producto desactivado no se le ofrece a nadie.
    const where: Prisma.ProductWhereInput = { isActive: true };
    const and: Prisma.ProductWhereInput[] = [];

    if (search?.trim()) {
      and.push({
        OR: [
          { name: { contains: search.trim(), mode: 'insensitive' } },
          { description: { contains: search.trim(), mode: 'insensitive' } },
        ],
      });
    }

    // Exclusividad de sucursal, igual que el catálogo web: con sucursal se ven los globales
    // (branchId null) más los exclusivos de esa; nunca los exclusivos de otra.
    if (branchId) {
      and.push({ OR: [{ branchId: null }, { branchId }] });
    }

    if (branchId && inStockOnly) {
      and.push({ inventories: { some: { branchId, stock: { gt: 0 } } } });
    } else if (inStockOnly) {
      and.push({ inventories: { some: { stock: { gt: 0 } } } });
    }

    if (and.length > 0) {
      where.AND = and;
    }

    try {
      const products = await this.prisma.product.findMany({
        where,
        take: limit,
        orderBy: { name: 'asc' },
        include: {
          category: { select: { name: true } },
          // Con sucursal solo traemos sus filas; sin sucursal, todas, para sumar el stock nacional.
          inventories: {
            ...(branchId ? { where: { branchId } } : {}),
            select: { size: true, stock: true, discountPrice: true, discountPercentage: true },
          },
        },
      });

      return {
        products: products.map((product) => this.formatProduct(product, branchId)),
        count: products.length,
        branchId: branchId ?? null,
        generatedAt: new Date().toISOString(),
      };
    } catch (error) {
      // El bot habla con clientes reales: si la base falla, se responde 503 y no una lista vacía,
      // porque "no tenemos nada en stock" y "no pude consultar" son cosas muy distintas para quien
      // está preguntando. La excepción de Nest se serializa como respuesta HTTP: no tumba la app.
      this.logger.error('No se pudo leer el catálogo para el chatbot', error instanceof Error ? error.stack : error);
      throw new ServiceUnavailableException(
        'El catálogo no está disponible en este momento. Intenta de nuevo en unos segundos.',
      );
    }
  }

  private formatProduct(
    product: Prisma.ProductGetPayload<{
      include: {
        category: { select: { name: true } };
        inventories: { select: { size: true; stock: true; discountPrice: true; discountPercentage: true } };
      };
    }>,
    branchId?: string,
  ): ChatbotProductDto {
    // Una talla puede tener una fila por sucursal, así que se suma. Se recorre Product.sizes (no las
    // filas) para que una talla declarada sin inventario salga con stock 0 en vez de desaparecer.
    const stockBySize = new Map<string, number>();
    for (const row of product.inventories) {
      stockBySize.set(row.size, (stockBySize.get(row.size) ?? 0) + row.stock);
    }

    const sizes = product.sizes.map((size) => ({ size, stock: stockBySize.get(size) ?? 0 }));
    const totalStock = sizes.reduce((sum, row) => sum + row.stock, 0);

    // El descuento vive en ProductInventory y se mantiene sincronizado entre las tallas de una misma
    // sucursal, así que cualquier fila sirve. Sin sucursal no hay un descuento único que aplicar:
    // se devuelve el precio de lista, igual que el catálogo web sin sucursal elegida.
    const inventory = branchId ? (product.inventories[0] ?? null) : null;

    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      description: product.description ?? '',
      category: product.category.name,
      price: Number(product.price),
      effectivePrice: getBranchPrice(product, inventory),
      currency: 'BOB',
      colors: product.colors,
      sizes,
      availableSizes: sizes.filter((row) => row.stock > 0).map((row) => row.size),
      totalStock,
      inStock: totalStock > 0,
      imageUrl: product.imageUrl ?? null,
    };
  }
}
