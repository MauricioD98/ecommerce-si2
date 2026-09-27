import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma, Product } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { BranchesService } from '../branches/branches.service';
import { InventoryService } from '../branches/inventory.service';
import { calculateTotals, getBranchPrice, getEmployeeDiscountPercent } from '../../common/utils/pricing';

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchesService: BranchesService,
    private readonly inventoryService: InventoryService,
  ) {}

  // Busca o crea el carrito activo del usuario.
  // Con branchId los precios usan el descuento de esa sucursal; sin sucursal, el precio base.
  async getOrCreateCart(userId: string, branchId?: string) {
    let cart = await this.prisma.cart.findFirst({
      where: { userId, checkout: false },
      include: {
        cartItems: {
          include: {
            product: true,
          },
        },
      },
    });

    if (!cart) {
      cart = await this.prisma.cart.create({
        data: { userId },
        include: {
          cartItems: {
            include: {
              product: true,
            },
          },
        },
      });
    }

    // Descuento de trabajador según el rol y el porcentaje del usuario
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { employeeDiscount: true },
    });
    const employeeDiscountPercent = user ? getEmployeeDiscountPercent(user) : 0;

    const inventoryMap = branchId
      ? await this.inventoryService.getInventoryMap(cart.cartItems.map((item) => item.productId), branchId)
      : {};

    const cartItems = cart.cartItems.map((item) => ({
      ...item,
      unitPrice: getBranchPrice(item.product, inventoryMap[item.productId]),
    }));

    // Precio con descuento de producto -> subtotal -> descuento de trabajador -> total
    const { subtotal, discountApplied, total } = calculateTotals(
      cartItems,
      employeeDiscountPercent,
    );

    return {
      ...cart,
      cartItems,
      subtotal,
      employeeDiscountPercent,
      discountApplied,
      total,
    };
  }

  // Agrega o incrementa la cantidad de un producto (una fila distinta por producto+talla). El
  // carrito ahora ES una reserva real: agregar descuenta el inventario de inmediato (RN: "reserva
  // de stock en el carrito"), no solo al pagar. Por eso solo se descuenta la CANTIDAD NUEVA
  // (`quantity`), nunca el acumulado: lo que ya había en el carrito ya se descontó cuando se agregó.
  async addItem(userId: string, dto: AddCartItemDto) {
    const { productId, quantity, branchId, size } = dto;

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product || !product.isActive) {
      throw new NotFoundException('El producto no está disponible');
    }

    if (size && !product.sizes.includes(size)) {
      throw new BadRequestException(`Talla inválida. Disponibles: ${product.sizes.join(', ')}`);
    }
    // Todo producto tiene al menos una talla (CreateProductDto la exige); sin ella no hay dónde
    // reservar el stock por talla.
    if (!size && product.sizes.length > 0) {
      throw new BadRequestException('Debe indicar una talla para este producto');
    }

    if (branchId) {
      await this.branchesService.findActiveOrFail(branchId);
    }

    const cart = await this.getOrCreateCart(userId);

    // findUnique no soporta null en una compound key (limitación de Prisma); se usa findFirst
    const existingItem = await this.prisma.cartItem.findFirst({
      where: { cartId: cart.id, productId, size: size ?? null },
    });

    await this.prisma.$transaction(async (tx) => {
      await this.reserveStock(tx, product, quantity, branchId, size);

      if (existingItem) {
        await tx.cartItem.update({
          where: { id: existingItem.id },
          data: {
            quantity: { increment: quantity },
            // Si ya había una reserva de otra sucursal (no debería pasar en el flujo normal, el
            // carrito se sincroniza con la sucursal elegida), se queda con la más reciente.
            branchId: branchId ?? existingItem.branchId,
          },
        });
      } else {
        await tx.cartItem.create({
          data: { cartId: cart.id, productId, quantity, size, branchId },
        });
      }
      // Marca el carrito como "recién activo": lo usa CartCleanupService para saber qué carritos
      // llevan más de 1 hora sin movimiento (abandonados) y liberar su stock reservado.
      await tx.cart.update({ where: { id: cart.id }, data: {} });
    });

    return this.getOrCreateCart(userId, branchId);
  }

  // Actualiza la cantidad exacta de un ítem: descuenta o devuelve solo la diferencia contra la
  // sucursal donde realmente se reservó el stock original (item.branchId), no la que venga en el
  // query de esta llamada puntual.
  async updateItemQuantity(userId: string, itemId: string, dto: UpdateCartItemDto) {
    const cart = await this.getOrCreateCart(userId);

    const item = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cartId: cart.id },
      include: { product: true },
    });

    if (!item) {
      throw new NotFoundException('Ítem no encontrado en el carrito');
    }

    const reservationBranchId = item.branchId ?? undefined;
    const delta = dto.quantity - item.quantity;

    await this.prisma.$transaction(async (tx) => {
      if (delta > 0) {
        await this.reserveStock(tx, item.product, delta, reservationBranchId, item.size);
      } else if (delta < 0) {
        await this.releaseStock(tx, item.productId, -delta, reservationBranchId, item.size);
      }

      await tx.cartItem.update({ where: { id: itemId }, data: { quantity: dto.quantity } });
      await tx.cart.update({ where: { id: cart.id }, data: {} });
    });

    return this.getOrCreateCart(userId, dto.branchId ?? reservationBranchId);
  }

  // Elimina un ítem específico y devuelve el stock que tenía reservado
  async removeItem(userId: string, itemId: string, branchId?: string) {
    const cart = await this.getOrCreateCart(userId);

    const item = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cartId: cart.id },
    });

    if (!item) {
      throw new NotFoundException('Ítem no encontrado en el carrito');
    }

    await this.prisma.$transaction(async (tx) => {
      if (item.quantity > 0) {
        await this.releaseStock(tx, item.productId, item.quantity, item.branchId ?? undefined, item.size);
      }
      await tx.cartItem.delete({ where: { id: itemId } });
    });

    return this.getOrCreateCart(userId, branchId);
  }

  // Vacía el carrito y devuelve el stock reservado de todos sus ítems
  async clearCart(userId: string, branchId?: string) {
    const cart = await this.getOrCreateCart(userId);

    await this.prisma.$transaction(async (tx) => {
      for (const item of cart.cartItems) {
        if (item.quantity > 0) {
          await this.releaseStock(tx, item.productId, item.quantity, item.branchId ?? undefined, item.size);
        }
      }
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
    });

    return this.getOrCreateCart(userId, branchId);
  }

  // Descuenta `quantity` del inventario real (por sucursal+talla, o del stock global legado sin
  // sucursal) y lanza 400 si no alcanza. Es la reserva propiamente dicha.
  private async reserveStock(
    tx: Prisma.TransactionClient,
    product: Product,
    quantity: number,
    branchId?: string | null,
    size?: string | null,
  ): Promise<void> {
    if (branchId) {
      // InventoryService.decrement ya lanza BadRequestException si no alcanza el stock de esa talla
      await this.inventoryService.decrement(tx, product.id, branchId, size ?? '', quantity);
      return;
    }

    const result = await tx.product.updateMany({
      where: { id: product.id, stock: { gte: quantity } },
      data: { stock: { decrement: quantity } },
    });
    if (result.count === 0) {
      throw new BadRequestException(`Stock insuficiente. Disponible: ${product.stock}`);
    }
  }

  // Devuelve `quantity` al inventario (contraparte de reserveStock)
  private async releaseStock(
    tx: Prisma.TransactionClient,
    productId: string,
    quantity: number,
    branchId?: string | null,
    size?: string | null,
  ): Promise<void> {
    if (branchId) {
      await this.inventoryService.increment(tx, productId, branchId, size ?? '', quantity);
      return;
    }
    await tx.product.update({
      where: { id: productId },
      data: { stock: { increment: quantity } },
    });
  }
}
