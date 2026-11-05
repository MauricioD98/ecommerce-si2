import { randomUUID } from 'node:crypto';
import { BadRequestException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { i18nMessage } from '../../i18n/i18n-message';
import { Prisma, Product, ProductInventory } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryResponseDto } from './dto/branch-response.dto';
import { DiscountDto } from './dto/discount.dto';
import { SetInventoryDto } from './dto/set-inventory.dto';
import { getBranchPrice } from '../../common/utils/pricing';
import { tenantSchemaSql } from '../../tenancy/tenant-context';
import { CheckoutCode, CheckoutException, outOfStock } from '../../common/checkout/checkout-errors';
import { withTxRetry } from '../../common/checkout/tx.util';

// Identidad de un efecto de stock: effectId único en inventory_movements lo hace aplicable una sola vez
export interface StockEffect {
  effectId?: string;
  reason?: string;
  refType?: string;
  refId?: string;
}

function assertValidQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new BadRequestException('La cantidad debe ser un entero positivo');
  }
}

// Descuento agregado de un producto en una sucursal (igual en todas sus tallas, ver setStock)
export interface InventoryAggregate {
  stock: number;
  discountPrice: Prisma.Decimal | null;
  discountPercentage: number | null;
  // Desglose del stock por talla en esa sucursal (lo que de verdad limita cuánto se puede vender de cada talla)
  sizes: { size: string; stock: number }[];
}

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}

  // Stock + descuento de UN producto en una sucursal, sumado entre todas sus tallas. Es lo que
  // usan el catálogo/checkout cuando todavía no importa la talla elegida (ej. mostrar la card).
  async getInventory(productId: string, branchId: string): Promise<InventoryAggregate | null> {
    const [product, rows] = await Promise.all([
      this.prisma.product.findUnique({ where: { id: productId }, select: { sizes: true } }),
      this.prisma.productInventory.findMany({ where: { productId, branchId } }),
    ]);
    if (!product) return null;
    return {
      stock: rows.reduce((sum, row) => sum + row.stock, 0),
      // Los descuentos se mantienen sincronizados entre tallas: cualquier fila sirve
      discountPrice: rows[0]?.discountPrice ?? null,
      discountPercentage: rows[0]?.discountPercentage ?? null,
      sizes: this.buildSizeBreakdown(product.sizes, rows),
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
    const [products, rows] = await Promise.all([
      this.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, sizes: true } }),
      this.prisma.productInventory.findMany({ where: { branchId, productId: { in: productIds } } }),
    ]);

    const rowsByProduct = new Map<string, ProductInventory[]>();
    for (const row of rows) {
      const current = rowsByProduct.get(row.productId) ?? [];
      current.push(row);
      rowsByProduct.set(row.productId, current);
    }

    const map: Record<string, InventoryAggregate> = {};
    for (const product of products) {
      const productRows = rowsByProduct.get(product.id) ?? [];
      map[product.id] = {
        stock: productRows.reduce((sum, row) => sum + row.stock, 0),
        // Los descuentos se mantienen sincronizados entre tallas: cualquier fila sirve
        discountPrice: productRows[0]?.discountPrice ?? null,
        discountPercentage: productRows[0]?.discountPercentage ?? null,
        sizes: this.buildSizeBreakdown(product.sizes, productRows),
      };
    }
    return map;
  }

  // Desglose por talla que consumen el POS y el catálogo: SIEMPRE trae una entrada por cada talla que
  // el producto declara, en ese mismo orden, y con stock 0 cuando la sucursal no tiene fila de
  // inventario para ella. Antes esas tallas simplemente no venían en el arreglo, así que el cliente no
  // podía distinguir "agotada acá" de "no me mandaron el desglose": terminaba cayendo al stock global
  // y mostraba como disponible una talla que no se puede vender.
  private buildSizeBreakdown(
    declaredSizes: string[],
    rows: { size: string; stock: number }[],
  ): { size: string; stock: number }[] {
    const stockBySize = new Map(rows.map((row) => [row.size, row.stock]));
    const breakdown = declaredSizes.map((size) => ({ size, stock: stockBySize.get(size) ?? 0 }));

    // Tallas con inventario que ya no figuran entre las del producto (se le quitaron después de
    // cargarles stock): van al final, para no esconder unidades que siguen físicamente en la tienda.
    for (const row of rows) {
      if (!declaredSizes.includes(row.size)) {
        breakdown.push({ size: row.size, stock: row.stock });
      }
    }

    return breakdown;
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
  //
  // Es un valor ABSOLUTO (un conteo físico), así que cada talla exige la versión leída: si cambió desde
  // entonces (se vendió algo), se responde 409 con el valor actual y nada se aplica. Una escritura offline
  // vieja no puede resucitar unidades vendidas, y nunca se convierte en un delta automáticamente.
  // operationId hace idempotente el reintento de la misma operación.
  async setStock(branchId: string, productId: string, dto: SetInventoryDto): Promise<InventoryResponseDto> {
    const [branch, product] = await Promise.all([
      this.prisma.branch.findUnique({ where: { id: branchId } }),
      this.prisma.product.findUnique({ where: { id: productId } }),
    ]);
    if (!branch) throw new NotFoundException('Branch not found');
    if (!product) throw new NotFoundException(i18nMessage('errors.PRODUCT_NOT_FOUND'));

    const invalidSizes = dto.sizes.map((s) => s.size).filter((size) => !product.sizes.includes(size));
    if (invalidSizes.length > 0) {
      throw new BadRequestException(`Invalid size(s) for this product: ${invalidSizes.join(', ')}. Available: ${product.sizes.join(', ')}`);
    }

    this.assertValidDiscount(Number(product.price), dto.discountPrice);
    const discountData = this.toDiscountData(dto);
    const sizes = [...dto.sizes].sort((a, b) => (a.size < b.size ? -1 : a.size > b.size ? 1 : 0));

    const rows = await withTxRetry(() =>
      this.prisma.$transaction(async (tx) => {
        const t = tenantSchemaSql();
        const conflicts: { size: string; expectedVersion: number; currentVersion: number; currentStock: number; proposedStock: number }[] = [];

        for (const { size, stock, expectedVersion } of sizes) {
          const effectId = `adjust:${dto.operationId}:${size}`;
          const claimed = await this.recordMovement(tx, { effectId, productId, branchId, size, stockDelta: 0, reason: 'ADJUSTMENT', refType: 'OPERATION', refId: dto.operationId });
          if (!claimed) continue; // reintento de una operación ya aplicada

          // Fila bloqueada: entre esta lectura y la escritura nadie más puede vender esta talla
          const [current] = await tx.$queryRaw<{ stock: number; version: number }[]>`
            SELECT "stock", "version" FROM ${t}."product_inventories"
            WHERE "productId" = ${productId} AND "branchId" = ${branchId} AND "size" = ${size} FOR UPDATE`;

          // Versión 0 = "la fila no existía cuando se leyó"
          const currentVersion = current?.version ?? 0;
          if (currentVersion !== expectedVersion) {
            conflicts.push({ size, expectedVersion, currentVersion, currentStock: current?.stock ?? 0, proposedStock: stock });
            continue;
          }
          if (current) {
            await tx.productInventory.update({
              where: { productId_branchId_size: { productId, branchId, size } },
              data: { stock, version: { increment: 1 }, ...discountData },
            });
          } else {
            await tx.productInventory.create({ data: { productId, branchId, size, stock, version: 1, ...discountData } });
          }
          await tx.inventoryMovement.update({ where: { effectId }, data: { stockDelta: stock - (current?.stock ?? 0) } });
        }

        // Lanzar revierte también lo ya aplicado de otras tallas: el ajuste es todo o nada
        if (conflicts.length > 0) {
          throw new CheckoutException(CheckoutCode.INVENTORY_VERSION_CONFLICT, HttpStatus.CONFLICT, {}, { conflicts });
        }

        // El descuento aplica parejo a TODAS las tallas del producto en esta sucursal, incluidas las
        // que no vinieron en este payload (para que no queden desincronizadas entre sí)
        if (Object.keys(discountData).length > 0) {
          await tx.productInventory.updateMany({ where: { productId, branchId }, data: discountData });
        }

        await this.syncGlobalStockMany(tx, [productId]);
        return tx.productInventory.findMany({ where: { productId, branchId } });
      }),
    );

    return this.toResponse(rows, product);
  }

  // SUPERADMIN: aplica el descuento a todas las sucursales (todas las tallas).
  // Las sucursales/tallas sin registro reciben uno con stock 0, para que la oferta ya esté vigente
  // cuando se cargue su stock.
  async applyDiscountToAllBranches(productId: string, dto: DiscountDto): Promise<{ updatedBranches: number }> {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException(i18nMessage('errors.PRODUCT_NOT_FOUND'));

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

  // Reclama un efecto en el libro de movimientos. false = ya se aplicó (reintento): no hay que repetirlo.
  private async recordMovement(tx: Prisma.TransactionClient, movement: Prisma.InventoryMovementCreateManyInput): Promise<boolean> {
    const { count } = await tx.inventoryMovement.createMany({ data: [movement], skipDuplicates: true });
    return count === 1;
  }

  // Descuenta stock de ESA variante (tienda + producto + sucursal + talla) de forma atómica. Si la fila no
  // existe o no alcanza, falla: nunca se asigna otra sucursal ni se autoriza con el agregado global. Pasar
  // unidades entre sucursales es una operación explícita (increment + decrement en una transacción).
  // El agregado NO se recalcula acá: el llamador hace un solo syncGlobalStockMany() al final, para respetar
  // el orden de bloqueos (inventario antes que producto, ver common/checkout/tx.util.ts).
  async decrement(
    tx: Prisma.TransactionClient,
    productId: string,
    branchId: string,
    size: string,
    quantity: number,
    effect: StockEffect = {},
  ): Promise<void> {
    assertValidQuantity(quantity);
    const claimed = await this.recordMovement(tx, {
      effectId: effect.effectId ?? randomUUID(),
      productId,
      branchId,
      size,
      stockDelta: -quantity,
      reason: effect.reason ?? 'SALE',
      refType: effect.refType,
      refId: effect.refId,
    });
    if (!claimed) return;

    const result = await tx.productInventory.updateMany({
      where: { productId, branchId, size, stock: { gte: quantity } },
      data: { stock: { decrement: quantity }, version: { increment: 1 } },
    });
    if (result.count === 0) throw outOfStock(size, productId);
  }

  async increment(
    tx: Prisma.TransactionClient,
    productId: string,
    branchId: string,
    size: string,
    quantity: number,
    effect: StockEffect = {},
  ): Promise<void> {
    assertValidQuantity(quantity);
    const claimed = await this.recordMovement(tx, {
      effectId: effect.effectId ?? randomUUID(),
      productId,
      branchId,
      size,
      stockDelta: quantity,
      reason: effect.reason ?? 'RELEASE',
      refType: effect.refType,
      refId: effect.refId,
    });
    if (!claimed) return;

    await tx.productInventory.upsert({
      where: { productId_branchId_size: { productId, branchId, size } },
      update: { stock: { increment: quantity }, version: { increment: 1 } },
      create: { productId, branchId, size, stock: quantity },
    });
  }

  // Devolución en mal estado: la prenda entra a mermas, NO al stock vendible. A propósito no toca el
  // agregado: Product.stock suma solo `stock`, así que estas unidades quedan fuera del catálogo,
  // de la caja y del carrito, y solo se ven en el reporte de inventario para auditoría o baja.
  async incrementDamaged(
    tx: Prisma.TransactionClient,
    productId: string,
    branchId: string,
    size: string,
    quantity: number,
    effect: StockEffect = {},
  ): Promise<void> {
    assertValidQuantity(quantity);
    const claimed = await this.recordMovement(tx, {
      effectId: effect.effectId ?? randomUUID(),
      productId,
      branchId,
      size,
      damagedDelta: quantity,
      reason: effect.reason ?? 'RETURN_DAMAGED',
      refType: effect.refType,
      refId: effect.refId,
    });
    if (!claimed) return;

    await tx.productInventory.upsert({
      where: { productId_branchId_size: { productId, branchId, size } },
      update: { damagedStock: { increment: quantity }, version: { increment: 1 } },
      create: { productId, branchId, size, stock: 0, damagedStock: quantity },
    });
  }

  // Recalcula Product.stock (agregado solo informativo) de varios productos en UNA ida a la base.
  // Dos transacciones que tocan variantes distintas del mismo producto se serializan acá: se toma primero
  // el bloqueo del producto (en orden por id, sin ciclos) y recién en la sentencia siguiente se suma, con un
  // snapshot nuevo que ya ve lo confirmado por quien tenía el bloqueo. Sumar en una sola sentencia usaría
  // un snapshot viejo y podría perder el cambio de la otra transacción. Se llama una vez al final de cada
  // transacción, porque después de bloquear el producto no se puede tomar otro bloqueo de inventario.
  async syncGlobalStockMany(tx: Prisma.TransactionClient, productIds: string[]): Promise<void> {
    const ids = [...new Set(productIds)].sort();
    if (ids.length === 0) return;

    // SQL crudo: Prisma no lo califica con el schema del tenant, hay que hacerlo a mano
    const t = tenantSchemaSql();
    // NO KEY UPDATE, no FOR UPDATE: insertar un order_item toma KEY SHARE sobre el producto por su FK. FOR
    // UPDATE chocaría con eso y formaría un ciclo con el bloqueo del inventario (deadlock medido en C01).
    await tx.$queryRaw`
      SELECT "id" FROM ${t}."products" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR NO KEY UPDATE
    `;
    await tx.$executeRaw`
      UPDATE ${t}."products" p
      SET "stock" = COALESCE(
        (SELECT SUM(pi."stock") FROM ${t}."product_inventories" pi WHERE pi."productId" = p."id"),
        0
      )
      WHERE p."id" IN (${Prisma.join(ids)})
    `;
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
      // Mermas del producto en la sucursal (devoluciones en mal estado). Va aparte de `stock` porque
      // no es vendible: el panel lo muestra solo para auditoría.
      damagedStock: rows.reduce((sum, row) => sum + row.damagedStock, 0),
      sizes: rows
        .slice()
        .sort((a, b) => a.size.localeCompare(b.size))
        .map((row) => ({ size: row.size, stock: row.stock, damagedStock: row.damagedStock, version: row.version })),
      productName: product.name,
      sku: product.sku,
      price: Number(product.price),
      discountPrice: discountPrice != null ? Number(discountPrice) : null,
      discountPercentage,
      effectivePrice: getBranchPrice(product, { discountPrice, discountPercentage }),
    };
  }
}
