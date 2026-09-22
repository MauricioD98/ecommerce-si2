import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { Prisma, Category, Product, ProductInventory } from '@prisma/client';
import { ProductResponseDto } from './dto/product-response.dto';
import { QueryProductDto } from './dto/query-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { InventoryService } from '../branches/inventory.service';
import { BulkDiscountDto } from '../branches/dto/bulk-discount.dto';
import { getBranchPrice } from '../../common/utils/pricing';
import { hasAllBranches } from '../../common/utils/permission.util';
import type { AuthUser } from '../../common/decorators/interfaces/request-with-user.interface';

@Injectable()
export class ProductsService {

    constructor(
      private prisma: PrismaService,
      private inventoryService: InventoryService,
    ) {}

// Create product
async create(createProductDto: CreateProductDto, actor: AuthUser): Promise<ProductResponseDto> {
  const existingSku = await this.prisma.product.findUnique({
    where: { sku: createProductDto.sku},
  });
  if (existingSku) {
    throw new ConflictException(
      `Product with SKU ${createProductDto.sku} already exist`,
    );
  }
  const category = await this.prisma.category.findUnique({
    where: { id: createProductDto.categoryId },
  });
  if (!category) {
    throw new BadRequestException(
      `Category with ID '${createProductDto.categoryId}' does not exist`,
    );
  }

  // Exclusividad de sucursal: nunca se confía en lo que mande el cliente para esto. Sin
  // ALL_BRANCHES, el producto SIEMPRE queda en la sucursal propia del usuario (se ignora
  // cualquier branchId que haya mandado); con ALL_BRANCHES, se respeta lo enviado (null = global).
  const branchId = hasAllBranches(actor) ? (createProductDto.branchId ?? null) : actor.branchId;
  if (!hasAllBranches(actor) && !branchId) {
    throw new BadRequestException('User is not assigned to a branch');
  }

  // El catálogo es global: el producto nace con stock 0 en todas las sucursales hasta que se asigne en el inventario
  const product = await this.prisma.product.create({
      data: {
        ...createProductDto,
        branchId,
        price: new Prisma.Decimal(createProductDto.price),
        stock: 0,
      },
      include:{
        category:true,
      }
    });

    return this.formatProduct(product);
 }


async findAll(queryDto: QueryProductDto): Promise<{
  data: ProductResponseDto[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}> {
  const { category, isActive, search, branchId, inStockOnly, page = 1, limit = 10 } = queryDto;

  const where: Prisma.ProductWhereInput = {};

if (category) {
  where.categoryId = category;
}

if (isActive !== undefined) {
  where.isActive = isActive;
}

if (search) {
  where.OR = [
    { name: { contains: search, mode: 'insensitive' } },
    { description: { contains: search, mode: 'insensitive' } },
  ];
}

// Catálogo del POS: solo productos con stock físico en esa sucursal
if (branchId && inStockOnly) {
  where.inventories = { some: { branchId, stock: { gt: 0 } } };
}

// Exclusividad de sucursal: con branchId se ven los productos globales (branchId null) más los
// exclusivos de ESA sucursal; nunca los exclusivos de otra. Sin branchId (nadie eligió sucursal
// todavía, o el panel admin global sin filtrar) no se filtra: se ve todo, como antes.
// Va en `AND` (no en `OR`, que ya lo puede estar usando el filtro de `search` arriba): Prisma
// combina claves del mismo nivel de `where` con AND implícito, así que esto queda como
// "(nombre o descripción coincide) AND (global o de esta sucursal)".
if (branchId) {
  where.AND = [{ OR: [{ branchId: null }, { branchId }] }];
}

const total = await this.prisma.product.count({ where });

const products = await this.prisma.product.findMany({
  where,
  skip: (page - 1) * limit,
  take: limit,
  orderBy: { createdAt: 'desc' },
  include: { category: true },
});

// Con sucursal, el stock y el descuento salen de su registro de inventario
const inventoryMap = branchId
  ? await this.inventoryService.getInventoryMap(products.map((p) => p.id), branchId)
  : null;

return {
  data: products.map((product) =>
    this.formatProduct(
      product,
      inventoryMap ? { inventory: inventoryMap[product.id] ?? null } : undefined,
    ),
  ),
  meta: {
  total,
  page,
  limit,
  totalPages: Math.ceil(total / limit),
},
};

}

async findOne(id: string, branchId?: string): Promise<ProductResponseDto> {
  const product = await this.prisma.product.findUnique({
    where: { id },
    include:{
      category:true,
    }
  });

  if (!product) {
    throw new NotFoundException('Product not found');
  }

  if (!branchId) {
    return this.formatProduct(product);
  }

  const inventory = await this.inventoryService.getInventory(id, branchId);
  return this.formatProduct(product, { inventory });
}
/*
async update(
  id: string,
  updateProductDto: UpdateProductDto,
): Promise<ProductResponseDto> {
  const existingProduct = await this.prisma.product.findUnique({
    where: { id },
  });

  if (!existingProduct) {
    throw new NotFoundException('Product not found');
  }

  if (updateProductDto.sku && updateProductDto.sku !== existingProduct.sku) {
  const skuTaken = await this.prisma.product.findUnique({
    where: { sku: updateProductDto.sku },
  });

  if (skuTaken) {
    throw new ConflictException(
      `Product with SKU ${updateProductDto.sku} already exists`,
    );
  }
 }
 const updateData: any = { ...updateProductDto };
if (updateProductDto && updateProductDto.price !== undefined) {
  updateData.price = new Prisma.Decimal(updateProductDto.price);
}

  const updatedProduct = await this.prisma.product.update({
  where: { id },
  data: updateData,
  include: {
    category: true,
  },
});
return this.formatProduct(updatedProduct);
}*/
async update(
  id: string,
  updateProductDto: UpdateProductDto,
  actor: AuthUser,
): Promise<ProductResponseDto> {
  // 1. Verificar si el producto existe
  const existingProduct = await this.prisma.product.findUnique({
    where: { id },
  });

  if (!existingProduct) {
    throw new NotFoundException('Product not found');
  }

  // Igual que en create(): sin ALL_BRANCHES no se puede reasignar la exclusividad de sucursal a
  // otra que no sea la propia (si mandó branchId, se fuerza a la suya; el resto del payload sigue
  // como estaba)
  if (updateProductDto.branchId !== undefined && !hasAllBranches(actor)) {
    updateProductDto.branchId = actor.branchId ?? undefined;
  }

  // 2. Validar SKU si se modifica
  if (updateProductDto.sku && updateProductDto.sku !== existingProduct.sku) {
    const skuTaken = await this.prisma.product.findUnique({
      where: { sku: updateProductDto.sku },
    });

    if (skuTaken) {
      throw new ConflictException(
        `Product with SKU ${updateProductDto.sku} already exists`,
      );
    }
  }

  // 3. Validar CategoryId ANTES de actualizar en base de datos
  if (updateProductDto.categoryId) {
    const categoryExists = await this.prisma.category.findUnique({
      where: { id: updateProductDto.categoryId },
    });

    if (!categoryExists) {
      throw new BadRequestException(
        `Category with ID '${updateProductDto.categoryId}' does not exist`,
      );
    }
  }

  // 4. Preparar payload para Prisma
  const updateData: Prisma.ProductUpdateInput = { ...updateProductDto };

  if (updateProductDto.price !== undefined) {
    updateData.price = new Prisma.Decimal(updateProductDto.price);
  }

  // 5. Ejecutar la actualización
  const updatedProduct = await this.prisma.product.update({
    where: { id },
    data: updateData,
    include: {
      category: true,
    },
  });

  return this.formatProduct(updatedProduct);
}

async updateStock(id: string, quantity: number): Promise<ProductResponseDto> {
  const product = await this.prisma.product.findUnique({
    where: { id },
  });

  if (!product) {
    throw new NotFoundException('Product not found');
  }

  const newStock = product.stock + quantity;

  if (newStock < 0) {
  throw new BadRequestException('Insufficient stock');
  }

  const updatedProduct = await this.prisma.product.update({
  where: { id },
  data: { stock: newStock },
  include: {
    category: true,
  },
});
  return this.formatProduct(updatedProduct);
}


async remove(id: string): Promise<{ message: string }> {
  const product = await this.prisma.product.findUnique({
    where: { id },
    include: {
      orderItems: true,
      cartItems: true,
    },
  });

  if (!product) {
  throw new NotFoundException('Product not found');
 }

if (product.orderItems.length > 0) {
  throw new BadRequestException(
    'Cannot delete product that is part of existing orders. Consider marking it as inactive only',
  );
 }

await this.prisma.product.delete({
  where: { id },
});

return { message: 'Product deleted successfully' };

}






 // SUPERADMIN: aplica el mismo descuento a un producto en todas las sucursales
 async applyDiscountToAllBranches(
  productId: string,
  dto: BulkDiscountDto,
): Promise<{ updatedBranches: number }> {
  return await this.inventoryService.applyDiscountToAllBranches(productId, dto);
}

// Sin contexto de sucursal no hay descuento ni stock de sucursal: el descuento vive en ProductInventory
 private formatProduct(
  product: Product & {category: Category},
  context?: { inventory: ProductInventory | null },
 ): ProductResponseDto {
  const inventory = context?.inventory ?? null;
  const hasDiscount =
    inventory != null &&
    (inventory.discountPrice != null || inventory.discountPercentage != null);

  return {
    ...product,
    price: Number(product.price),
    effectivePrice: getBranchPrice(product, inventory),
    branchStock: context ? (inventory?.stock ?? 0) : null,
    discount: hasDiscount
      ? {
          discountPrice: inventory.discountPrice != null ? Number(inventory.discountPrice) : null,
          discountPercentage: inventory.discountPercentage,
        }
      : null,
    category: product.category.name,
    sizes: product.sizes as ProductResponseDto['sizes'],
  };
}

}
