import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Product, ProductInventory } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryResponseDto } from './dto/branch-response.dto';
import { DiscountDto } from './dto/discount.dto';
import { SetInventoryDto } from './dto/set-inventory.dto';
import { getBranchPrice } from '../../common/utils/pricing';

// Descuento agregado de un producto en una sucursal (igual en todas sus tallas, ver setStock)
export interface InventoryAggregate {
  stock: number;
  discountPrice: Prisma.Decimal | null;
  discountPercentage: number | null;
}

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}

  // Stock + descuento de UN producto en una sucursal, sumado entre todas sus tallas. Es lo que
  // usan el catálogo/checkout cuando todavía no importa la talla elegida (ej. mostrar la card).
  async getInventory(productId: string, branchId: string): Promise<InventoryAggregate | null> {
    const rows = await this.prisma.productInventory.findMany({ where: { productId, branchId } });
    if (rows.length === 0) return null;
    return {
      stock: rows.reduce((sum, row) => sum + row.stock, 0),
      // Los descuentos se mantienen sincronizados entre tallas: cualquier fila sirve
      discountPrice: rows[0].discountPrice,
      discountPercentage: rows[0].discountPercentage,
    };
  }

  // Registro puntual de una talla específica (lo que de verdad se descuenta al vender)
  async getInventoryForSize(productId: string, branchId: string, size: string): Promise<ProductInventory | null> {
    return await this.prisma.productInventory.findUnique({
      where: { productId_branchId_size: { productId, branchId, size } },
    });
  }

  async getStockForSize(productId: string, branchId: string, size: string): Promise<number> {
    const inventory = await this.getInventoryForSize(productId, branchId, size);
    return inventory?.stock ?? 0;
  }

  // Agregado (stock total + descuento) de varios productos en una sucursal: { [productId]: agregado }
  async getInventoryMap(
    productIds: string[],
    branchId: string,
  ): Promise<Record<string, InventoryAggregate>> {
    const rows = await this.prisma.productInventory.findMany({
      where: { branchId, productId: { in: productIds } },
    });
    const map: Record<string, InventoryAggregate> = {};
    for (const row of rows) {
      const current = map[row.productId] ?? { stock: 0, discountPrice: row.discountPrice, discountPercentage: row.discountPercentage };
      current.stock += row.stock;
      map[row.productId] = current;
    }
    return map;
  }

  // Inventario de una sucursal para el panel admin: una fila por producto, con el stock desglosado por talla
  async listByBranch(branchId: string): Promise<InventoryResponseDto[]> {
    const rows = await this.prisma.productInventory.findMany({
      where: { branchId },
      include: { product: true },
      orderBy: [{ product: { name: 'asc' } }, { size: 'asc' }],
    });

    const byProduct = new Map<string, { product: Product; rows: ProductInventory[] }>();
    for (const row of rows) {
      const entry = byProduct.get(row.productId) ?? { product: row.product, rows: [] };
      entry.rows.push(row);
      byProduct.set(row.productId, entry);
    }

    return Array.from(byProduct.values()).map(({ product, rows: productRows }) => this.toResponse(productRows, product));
  }

  // Fija el stock por talla y, opcionalmente, el descuento (igual para todas las tallas) de un
  // producto en una sucursal. Solo acepta tallas que el producto realmente tiene.
  async setStock(branchId: string, productId: string, dto: SetInventoryDto): Promise<InventoryResponseDto> {
    const [branch, product] = await Promise.all([
      this.prisma.branch.findUnique({ where: { id: branchId } }),
      this.prisma.product.findUnique({ where: { id: productId } }),
    ]);
    if (!branch) throw new NotFoundException('Branch not found');
    if (!product) throw new NotFoundException('Product not found');

    const invalidSizes = dto.sizes.map((s) => s.size).filter((size) => !product.sizes.includes(size));
    if (invalidSizes.length > 0) {
      throw new BadRequestException(`Invalid size(s) for this product: ${invalidSizes.join(', ')}. Available: ${product.sizes.join(', ')}`);
    }

    this.assertValidDiscount(Number(product.price), dto.discountPrice);
    const discountData = this.toDiscountData(dto);

    const rows = await this.prisma.$transaction(async (tx) => {
      for (const { size, stock } of dto.sizes) {
        await tx.productInventory.upsert({
          where: { productId_branchId_size: { productId, branchId, size } },
          update: { stock, ...discountData },
          create: { productId, branchId, size, stock, ...discountData },
        });
      }

      // El descuento aplica parejo a TODAS las tallas del producto en esta sucursal, incluidas las
      // que no vinieron en este payload (para que no queden desincronizadas entre sí)
      if (Object.keys(discountData).length > 0) {
        await tx.productInventory.updateMany({ where: { productId, branchId }, data: discountData });
      }

      await this.syncGlobalStock(tx, productId);
      return tx.productInventory.findMany({ where: { productId, branchId } });
    });

    return this.toResponse(rows, product);
  }

  // SUPERADMIN: aplica el descuento a todas las sucursales (todas las tallas).
  // Las sucursales/tallas sin registro reciben uno con stock 0, para que la oferta ya esté vigente
  // cuando se cargue su stock.
  async applyDiscountToAllBranches(productId: string, dto: DiscountDto): Promise<{ updatedBranches: number }> {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');

    const discountData = this.toDiscountData(dto);
    if (Object.keys(discountData).length === 0) {
      throw new BadRequestException('Provide discountPrice and/or discountPercentage');
    }
    this.assertValidDiscount(Number(product.price), dto.discountPrice);

    const branches = await this.prisma.branch.findMany({ select: { id: true } });

    await this.prisma.$transaction(async (tx) => {
      await tx.productInventory.createMany({
        data: branches.flatMap((branch) => product.sizes.map((size) => ({ productId, branchId: branch.id, size, stock: 0 }))),
        skipDuplicates: true,
      });
      await tx.productInventory.updateMany({
        where: { productId },
        data: discountData,
      });
    });

    return { updatedBranches: branches.length };
  }

  // Descuenta stock de la talla en la sucursal de forma atómica (falla si no alcanza)
  async decrement(
    tx: Prisma.TransactionClient,
    productId: string,
    branchId: string,
    size: string,
    quantity: number,
  ): Promise<void> {
    const result = await tx.productInventory.updateMany({
      where: { productId, branchId, size, stock: { gte: quantity } },
      data: { stock: { decrement: quantity } },
    });
    if (result.count === 0) {
      // Si la sucursal no tiene fila asignada o stock suficiente para la talla, verificar stock global
      const prod = await tx.product.findUnique({ where: { id: productId } });
      if (prod && prod.stock >= quantity) {
        await tx.product.update({
          where: { id: productId },
          data: { stock: { decrement: quantity } },
        });
        return;
      }
      throw new BadRequestException(`Insufficient stock for size ${size} in the selected branch`);
    }
    await this.syncGlobalStock(tx, productId);
  }

  async increment(
    tx: Prisma.TransactionClient,
    productId: string,
    branchId: string,
    size: string,
    quantity: number,
  ): Promise<void> {
    await tx.productInventory.upsert({
      where: { productId_branchId_size: { productId, branchId, size } },
      update: { stock: { increment: quantity } },
      create: { productId, branchId, size, stock: quantity },
    });
    await this.syncGlobalStock(tx, productId);
  }

  // Mantiene Product.stock (global, legado) como la suma del stock de todas las sucursales y tallas
  private async syncGlobalStock(tx: Prisma.TransactionClient, productId: string): Promise<void> {
    const { _sum } = await tx.productInventory.aggregate({
      where: { productId },
      _sum: { stock: true },
    });
    await tx.product.update({
      where: { id: productId },
      data: { stock: _sum.stock ?? 0 },
    });
  }

  // Solo incluye los campos enviados: undefined = sin cambios, null = quitar el descuento
  private toDiscountData(dto: DiscountDto): { discountPrice?: Prisma.Decimal | null; discountPercentage?: number | null } {
    const data: { discountPrice?: Prisma.Decimal | null; discountPercentage?: number | null } = {};
    if (dto.discountPrice !== undefined) {
      data.discountPrice = dto.discountPrice === null ? null : new Prisma.Decimal(dto.discountPrice);
    }
    if (dto.discountPercentage !== undefined) {
      data.discountPercentage = dto.discountPercentage;
    }
    return data;
  }

  // El precio de oferta debe ser menor al precio base del producto
  private assertValidDiscount(price: number, discountPrice?: number | null): void {
    if (discountPrice != null && discountPrice >= price) {
      throw new BadRequestException('discountPrice must be lower than the product price');
    }
  }

  private toResponse(rows: ProductInventory[], product: Product): InventoryResponseDto {
    // Los descuentos están sincronizados entre tallas: cualquier fila sirve de referencia
    const discountPrice = rows[0]?.discountPrice ?? null;
    const discountPercentage = rows[0]?.discountPercentage ?? null;

    return {
      productId: product.id,
      branchId: rows[0]?.branchId ?? '',
      stock: rows.reduce((sum, row) => sum + row.stock, 0),
      sizes: rows
        .slice()
        .sort((a, b) => a.size.localeCompare(b.size))
        .map((row) => ({ size: row.size, stock: row.stock })),
      productName: product.name,
      sku: product.sku,
      price: Number(product.price),
      discountPrice: discountPrice != null ? Number(discountPrice) : null,
      discountPercentage,
      effectivePrice: getBranchPrice(product, { discountPrice, discountPercentage }),
    };
  }
}
