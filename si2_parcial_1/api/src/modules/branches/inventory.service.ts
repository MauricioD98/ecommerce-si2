import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Product, ProductInventory } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryResponseDto } from './dto/branch-response.dto';
import { DiscountDto } from './dto/discount.dto';
import { SetInventoryDto } from './dto/set-inventory.dto';
import { getBranchPrice } from '../../common/utils/pricing';

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}

  // Registro de inventario (stock + descuentos) de un producto en una sucursal
  async getInventory(productId: string, branchId: string): Promise<ProductInventory | null> {
    return await this.prisma.productInventory.findUnique({
      where: { productId_branchId: { productId, branchId } },
    });
  }

  // Stock de un producto en una sucursal (0 si no tiene registro)
  async getStock(productId: string, branchId: string): Promise<number> {
    const inventory = await this.getInventory(productId, branchId);
    return inventory?.stock ?? 0;
  }

  // Registros de varios productos en una sucursal: { [productId]: inventario }
  async getInventoryMap(
    productIds: string[],
    branchId: string,
  ): Promise<Record<string, ProductInventory>> {
    const inventories = await this.prisma.productInventory.findMany({
      where: { branchId, productId: { in: productIds } },
    });
    return Object.fromEntries(inventories.map((i) => [i.productId, i]));
  }

  async listByBranch(branchId: string): Promise<InventoryResponseDto[]> {
    const inventories = await this.prisma.productInventory.findMany({
      where: { branchId },
      include: { product: true },
      orderBy: { product: { name: 'asc' } },
    });
    return inventories.map((i) => this.toResponse(i, i.product));
  }

  // Fija el stock absoluto y, opcionalmente, el descuento de un producto en una sucursal
  async setStock(branchId: string, productId: string, dto: SetInventoryDto): Promise<InventoryResponseDto> {
    const [branch, product] = await Promise.all([
      this.prisma.branch.findUnique({ where: { id: branchId } }),
      this.prisma.product.findUnique({ where: { id: productId } }),
    ]);
    if (!branch) throw new NotFoundException('Branch not found');
    if (!product) throw new NotFoundException('Product not found');

    this.assertValidDiscount(Number(product.price), dto.discountPrice);
    const discountData = this.toDiscountData(dto);

    const inventory = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.productInventory.upsert({
        where: { productId_branchId: { productId, branchId } },
        update: { stock: dto.stock, ...discountData },
        create: { productId, branchId, stock: dto.stock, ...discountData },
      });
      await this.syncGlobalStock(tx, productId);
      return saved;
    });

    return this.toResponse(inventory, product);
  }

  // SUPERADMIN: aplica el descuento a todas las sucursales.
  // Las sucursales sin registro del producto reciben uno con stock 0, para que la oferta ya
  // esté vigente cuando se cargue su stock.
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
        data: branches.map((branch) => ({ productId, branchId: branch.id, stock: 0 })),
        skipDuplicates: true,
      });
      await tx.productInventory.updateMany({
        where: { productId },
        data: discountData,
      });
    });

    return { updatedBranches: branches.length };
  }

  // Descuenta stock de la sucursal de forma atómica (falla si no alcanza)
  async decrement(
    tx: Prisma.TransactionClient,
    productId: string,
    branchId: string,
    quantity: number,
  ): Promise<void> {
    const result = await tx.productInventory.updateMany({
      where: { productId, branchId, stock: { gte: quantity } },
      data: { stock: { decrement: quantity } },
    });
    if (result.count === 0) {
      throw new BadRequestException('Insufficient stock in the selected branch');
    }
    await this.syncGlobalStock(tx, productId);
  }

  async increment(
    tx: Prisma.TransactionClient,
    productId: string,
    branchId: string,
    quantity: number,
  ): Promise<void> {
    await tx.productInventory.upsert({
      where: { productId_branchId: { productId, branchId } },
      update: { stock: { increment: quantity } },
      create: { productId, branchId, stock: quantity },
    });
    await this.syncGlobalStock(tx, productId);
  }

  // Mantiene Product.stock (global, legado) como la suma del stock de todas las sucursales
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

  private toResponse(inventory: ProductInventory, product: Product): InventoryResponseDto {
    return {
      productId: inventory.productId,
      branchId: inventory.branchId,
      stock: inventory.stock,
      productName: product.name,
      sku: product.sku,
      price: Number(product.price),
      discountPrice: inventory.discountPrice != null ? Number(inventory.discountPrice) : null,
      discountPercentage: inventory.discountPercentage,
      effectivePrice: getBranchPrice(product, inventory),
    };
  }
}
