import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Product } from '@prisma/client';
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

  // Agrega o incrementa la cantidad de un producto (una fila distinta por producto+talla)
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

    const cart = await this.getOrCreateCart(userId);

    // findUnique no soporta null en una compound key (limitación de Prisma); se usa findFirst
    const existingItem = await this.prisma.cartItem.findFirst({
      where: { cartId: cart.id, productId, size: size ?? null },
    });

    const currentQtyInCart = existingItem ? existingItem.quantity : 0;
    const requestedQty = currentQtyInCart + quantity;

    await this.assertStock(product, requestedQty, branchId);

    if (existingItem) {
      await this.prisma.cartItem.update({
        where: { id: existingItem.id },
        data: { quantity: requestedQty },
      });
    } else {
      await this.prisma.cartItem.create({
        data: {
          cartId: cart.id,
          productId,
          quantity,
          size,
        },
      });
    }

    return this.getOrCreateCart(userId, branchId);
  }

  // Actualiza la cantidad exacta de un ítem
  async updateItemQuantity(userId: string, itemId: string, dto: UpdateCartItemDto) {
    const cart = await this.getOrCreateCart(userId);

    const item = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cartId: cart.id },
      include: { product: true },
    });

    if (!item) {
      throw new NotFoundException('Ítem no encontrado en el carrito');
    }

    await this.assertStock(item.product, dto.quantity, dto.branchId);

    await this.prisma.cartItem.update({
      where: { id: itemId },
      data: { quantity: dto.quantity },
    });

    return this.getOrCreateCart(userId, dto.branchId);
  }

  // Elimina un ítem específico
  async removeItem(userId: string, itemId: string, branchId?: string) {
    const cart = await this.getOrCreateCart(userId);

    const item = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cartId: cart.id },
    });

    if (!item) {
      throw new NotFoundException('Ítem no encontrado en el carrito');
    }

    await this.prisma.cartItem.delete({
      where: { id: itemId },
    });

    return this.getOrCreateCart(userId, branchId);
  }

  // Vacía el carrito
  async clearCart(userId: string, branchId?: string) {
    const cart = await this.getOrCreateCart(userId);

    await this.prisma.cartItem.deleteMany({
      where: { cartId: cart.id },
    });

    return this.getOrCreateCart(userId, branchId);
  }

  // Valida el stock de la sucursal indicada; sin sucursal usa el stock global (retrocompatible)
  private async assertStock(product: Product, requestedQty: number, branchId?: string) {
    let available = product.stock;

    if (branchId) {
      await this.branchesService.findActiveOrFail(branchId);
      available = await this.inventoryService.getStock(product.id, branchId);
    }

    if (requestedQty > available) {
      throw new BadRequestException(`Stock insuficiente. Disponible: ${available}`);
    }
  }
}
