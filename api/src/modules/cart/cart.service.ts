import { Injectable, NotFoundException, BadRequestException, HttpStatus } from '@nestjs/common';
import { Prisma, ReservationStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { SyncCartDto } from './dto/sync-cart.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { BranchesService } from '../branches/branches.service';
import { InventoryService } from '../branches/inventory.service';
import { calculateTotals, getBranchPrice, getEmployeeDiscountPercent } from '../../common/utils/pricing';
import { currentLanguage, localizeProductRow } from '../products/product-translations';
import { CheckoutCode, CheckoutException } from '../../common/checkout/checkout-errors';
import { cartReservationTtlMs } from '../../common/checkout/checkout-policy';
import { compareVariants, lockCart, withTxRetry } from '../../common/checkout/tx.util';
import { tenantSchemaSql } from '../../tenancy/tenant-context';

type Tx = Prisma.TransactionClient;
type DesiredLine = { productId: string; size: string; branchId: string; quantity: number };

// El carrito es una reserva real: agregar descuenta el inventario de inmediato (RN: "reserva de stock en
// el carrito"). Cada línea tiene una StockReservation. Todas las mutaciones siguen el mismo protocolo: se
// bloquea el carrito, se leen sus ítems DENTRO de la transacción, se liberan las reservas vencidas y solo
// se aplica la diferencia. Por eso dos pestañas concurrentes nunca calculan deltas sobre datos obsoletos.
@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchesService: BranchesService,
    private readonly inventoryService: InventoryService,
  ) {}

  // Un solo carrito activo por usuario, garantizado por el índice único de activeUserId
  private async ensureActiveCartId(userId: string): Promise<string> {
    const t = tenantSchemaSql();
    await this.prisma.$executeRaw`
      INSERT INTO ${t}."carts" ("id", "userId", "activeUserId", "updatedAt")
      VALUES (${randomUUID()}, ${userId}, ${userId}, NOW())
      ON CONFLICT ("activeUserId") DO NOTHING`;
    const cart = await this.prisma.cart.findUniqueOrThrow({ where: { activeUserId: userId }, select: { id: true } });
    return cart.id;
  }

  // Busca o crea el carrito activo del usuario.
  // Con branchId los precios usan el descuento de esa sucursal; sin sucursal, el precio base.
  async getOrCreateCart(userId: string, branchId?: string) {
    const cartId = await this.ensureActiveCartId(userId);

    // Acceso crítico: una reserva vencida no se muestra como vigente aunque el cron no haya pasado
    const hasExpired = await this.prisma.stockReservation.count({
      where: { cartId, status: ReservationStatus.ACTIVE, expiresAt: { lt: new Date() } },
    });
    if (hasExpired > 0) {
      await withTxRetry(() =>
        this.prisma.$transaction(async (tx) => {
          await lockCart(tx, cartId);
          await this.expireLocked(tx, cartId);
        }),
      );
    }

    const cart = await this.prisma.cart.findUniqueOrThrow({
      where: { id: cartId },
      include: { cartItems: { include: { product: true, reservation: { select: { expiresAt: true, status: true } } } } },
    });

    // Descuento de trabajador según el rol y el porcentaje del usuario
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { employeeDiscount: true },
    });
    const employeeDiscountPercent = user ? getEmployeeDiscountPercent(user) : 0;

    const inventoryMap = branchId
      ? await this.inventoryService.getInventoryMap(cart.cartItems.map((item) => item.productId), branchId)
      : {};

    // El producto sale con name/description en el idioma del request (Accept-Language); el precio
    // se calcula con la fila original, que es la misma salvo esos textos
    const language = currentLanguage();
    const cartItems = cart.cartItems.map((item) => ({
      ...item,
      product: localizeProductRow(item.product, language),
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

  // Agrega o incrementa la cantidad de un producto (una fila distinta por producto+talla).
  async addItem(userId: string, dto: AddCartItemDto) {
    const { productId, quantity, branchId, size } = dto;
    const product = await this.prisma.product.findUnique({ where: { id: productId } });

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
    const lineSize = size ?? '';

    if (branchId) {
      await this.branchesService.findActiveOrFail(branchId);
    }

    await this.mutate(userId, dto.expectedVersion, async (tx, cartId) => {
      const existing = await tx.cartItem.findFirst({ where: { cartId, productId, size: lineSize } });
      const targetBranch = branchId ?? existing?.branchId ?? (await this.requireDefaultBranch());
      await this.applyLines(tx, userId, cartId, [
        { productId, size: lineSize, branchId: targetBranch, quantity: (existing?.quantity ?? 0) + quantity },
      ]);
    });

    return this.getOrCreateCart(userId, branchId);
  }

  // Actualiza la cantidad exacta de un ítem. Con otro branchId además mueve la reserva a esa sucursal:
  // reserva el destino y libera el origen en una transacción, o falla entero.
  async updateItemQuantity(userId: string, itemId: string, dto: UpdateCartItemDto) {
    let resultBranch: string | undefined;
    await this.mutate(userId, dto.expectedVersion, async (tx, cartId) => {
      const item = await tx.cartItem.findFirst({ where: { id: itemId, cartId } });
      if (!item) throw new NotFoundException('Ítem no encontrado en el carrito');
      const targetBranch = dto.branchId ?? item.branchId ?? (await this.requireDefaultBranch());
      resultBranch = targetBranch;
      await this.applyLines(tx, userId, cartId, [
        { productId: item.productId, size: item.size ?? '', branchId: targetBranch, quantity: dto.quantity },
      ]);
    });

    return this.getOrCreateCart(userId, resultBranch);
  }

  // Elimina un ítem específico y devuelve el stock que tenía reservado
  async removeItem(userId: string, itemId: string, branchId?: string) {
    await this.mutate(userId, undefined, async (tx, cartId) => {
      const item = await tx.cartItem.findFirst({ where: { id: itemId, cartId } });
      if (!item) throw new NotFoundException('Ítem no encontrado en el carrito');
      await this.applyLines(tx, userId, cartId, [
        { productId: item.productId, size: item.size ?? '', branchId: item.branchId ?? '', quantity: 0 },
      ]);
    });

    return this.getOrCreateCart(userId, branchId);
  }

  // Vacía el carrito y devuelve el stock reservado de todos sus ítems
  async clearCart(userId: string, branchId?: string) {
    await this.mutate(userId, undefined, async (tx, cartId) => {
      const items = await tx.cartItem.findMany({ where: { cartId } });
      await this.applyLines(
        tx,
        userId,
        cartId,
        items.map((item) => ({ productId: item.productId, size: item.size ?? '', branchId: item.branchId ?? '', quantity: 0 })),
      );
    });

    return this.getOrCreateCart(userId, branchId);
  }

  // Deja el carrito del servidor exactamente como el carrito local, en una transacción y aplicando solo
  // diferencias. Si una línea no tiene stock falla todo (nada a medias) y lo reservado sigue reservado.
  async syncCart(userId: string, dto: SyncCartDto) {
    const lines = new Map<string, DesiredLine>();
    const productIds = [...new Set(dto.items.map((item) => item.productId))];
    const products = await this.prisma.product.findMany({ where: { id: { in: productIds } } });
    const productById = new Map(products.map((product) => [product.id, product]));
    if (dto.branchId) await this.branchesService.findActiveOrFail(dto.branchId);

    for (const item of dto.items) {
      const product = productById.get(item.productId);
      if (!product || !product.isActive) throw new NotFoundException('El producto no está disponible');
      if (!product.sizes.includes(item.size)) {
        throw new BadRequestException(`Talla inválida. Disponibles: ${product.sizes.join(', ')}`);
      }
      const key = `${item.productId}|${item.size}`;
      const current = lines.get(key);
      lines.set(key, {
        productId: item.productId,
        size: item.size,
        branchId: dto.branchId ?? '',
        quantity: (current?.quantity ?? 0) + item.quantity,
      });
    }

    await this.mutate(userId, dto.expectedVersion, async (tx, cartId) => {
      const defaultBranch = dto.branchId ?? (lines.size > 0 ? await this.requireDefaultBranch() : '');
      const items = await tx.cartItem.findMany({ where: { cartId } });
      const desired: DesiredLine[] = [...lines.values()].map((line) => ({ ...line, branchId: defaultBranch }));
      for (const item of items) {
        const key = `${item.productId}|${item.size ?? ''}`;
        if (!lines.has(key)) {
          desired.push({ productId: item.productId, size: item.size ?? '', branchId: item.branchId ?? '', quantity: 0 });
        }
      }
      await this.applyLines(tx, userId, cartId, desired);
    });

    return this.getOrCreateCart(userId, dto.branchId);
  }

  // Devuelve al stock las reservas vencidas de un carrito ya bloqueado. Revalida el vencimiento con la
  // fila leída dentro de la transacción: dos réplicas del cron liberan una sola vez, y si el checkout
  // consumió la reserva primero, acá ya no está ACTIVE. Un carrito sin activeUserId es un duplicado
  // heredado: sus reservas nacieron vencidas por la migración.
  async expireLocked(tx: Tx, cartId: string, now = new Date()): Promise<number> {
    const expired = await tx.stockReservation.findMany({
      where: { cartId, status: ReservationStatus.ACTIVE, expiresAt: { lt: now } },
    });
    if (expired.length === 0) return 0;

    const sorted = [...expired].sort(compareVariants);
    for (const reservation of sorted) {
      await this.inventoryService.increment(tx, reservation.productId, reservation.branchId, reservation.size, reservation.quantity, {
        effectId: `expire:${reservation.id}:${reservation.revision}`,
        reason: 'RESERVATION_EXPIRED',
        refType: 'RESERVATION',
        refId: reservation.id,
      });
      await tx.stockReservation.update({
        where: { id: reservation.id },
        data: { status: ReservationStatus.EXPIRED, cartItemId: null },
      });
      if (reservation.cartItemId) await tx.cartItem.deleteMany({ where: { id: reservation.cartItemId } });
    }
    await tx.cart.update({ where: { id: cartId }, data: { version: { increment: 1 } } });
    await this.inventoryService.syncGlobalStockMany(tx, sorted.map((reservation) => reservation.productId));
    return sorted.length;
  }

  private async requireDefaultBranch(): Promise<string> {
    const branch = await this.branchesService.findFirstActive();
    if (!branch) throw new BadRequestException('No hay sucursales activas para reservar stock');
    return branch.id;
  }

  // Protocolo común de toda mutación: carrito bloqueado, versión validada, vencidas liberadas, cambio
  // aplicado, nueva revisión y TTL renovado (la actividad del usuario extiende su reserva).
  private async mutate(userId: string, expectedVersion: number | undefined, fn: (tx: Tx, cartId: string) => Promise<void>): Promise<void> {
    const cartId = await this.ensureActiveCartId(userId);
    await withTxRetry(() =>
      this.prisma.$transaction(async (tx) => {
        await lockCart(tx, cartId);
        const cart = await tx.cart.findUniqueOrThrow({ where: { id: cartId }, select: { version: true } });
        if (expectedVersion !== undefined && cart.version !== expectedVersion) {
          throw new CheckoutException(CheckoutCode.CART_VERSION_CONFLICT, HttpStatus.CONFLICT, {}, { currentVersion: cart.version });
        }
        await this.expireLocked(tx, cartId);
        await fn(tx, cartId);
        await tx.stockReservation.updateMany({
          where: { cartId, status: ReservationStatus.ACTIVE },
          data: { expiresAt: new Date(Date.now() + cartReservationTtlMs()) },
        });
        await tx.cart.update({ where: { id: cartId }, data: { version: { increment: 1 } } });
      }),
    );
  }

  // Lleva cada línea del carrito (ya bloqueado) al estado pedido, aplicando solo la diferencia contra su
  // reserva. Cambio de sucursal: reserva destino + libera origen. Los movimientos se ordenan por variante
  // para respetar el orden único de bloqueos.
  private async applyLines(tx: Tx, userId: string, cartId: string, desired: DesiredLine[]): Promise<void> {
    const items = await tx.cartItem.findMany({ where: { cartId }, include: { reservation: true } });
    const itemByKey = new Map(items.map((item) => [`${item.productId}|${item.size ?? ''}`, item]));

    type Step = { kind: 'take' | 'give'; productId: string; branchId: string; size: string; quantity: number; effectId: string; reservationId: string };
    const steps: Step[] = [];
    const after: (() => Promise<void>)[] = [];
    const touched: string[] = [];

    for (const line of desired) {
      const item = itemByKey.get(`${line.productId}|${line.size}`);
      const reservation = item?.reservation?.status === ReservationStatus.ACTIVE ? item.reservation : null;
      const reservationId = reservation?.id ?? randomUUID();
      const revision = (reservation?.revision ?? -1) + 1;
      const effect = (suffix: string) => `reservation:${reservationId}:${revision}:${suffix}`;
      touched.push(line.productId);

      if (reservation && reservation.branchId !== line.branchId) {
        // Cambio de sucursal (o eliminación con reserva en otra): se libera todo el origen
        steps.push({ kind: 'give', productId: line.productId, branchId: reservation.branchId, size: line.size, quantity: reservation.quantity, effectId: effect('release-origin'), reservationId });
        if (line.quantity > 0) {
          steps.push({ kind: 'take', productId: line.productId, branchId: line.branchId, size: line.size, quantity: line.quantity, effectId: effect('reserve-target'), reservationId });
        }
      } else {
        // Sin reserva (línea heredada sin sucursal/talla): no hay nada que devolver y se reserva todo
        const held = reservation?.quantity ?? 0;
        const delta = line.quantity - held;
        if (delta > 0) {
          steps.push({ kind: 'take', productId: line.productId, branchId: line.branchId, size: line.size, quantity: delta, effectId: effect('reserve'), reservationId });
        } else if (delta < 0) {
          const branchId = reservation?.branchId ?? line.branchId;
          steps.push({ kind: 'give', productId: line.productId, branchId, size: line.size, quantity: -delta, effectId: effect('release'), reservationId });
        }
      }

      after.push(async () => {
        if (line.quantity === 0) {
          if (reservation) {
            await tx.stockReservation.update({
              where: { id: reservation.id },
              data: { status: ReservationStatus.RELEASED, cartItemId: null, revision },
            });
          }
          if (item) await tx.cartItem.delete({ where: { id: item.id } });
          return;
        }

        const savedItem = item
          ? await tx.cartItem.update({ where: { id: item.id }, data: { quantity: line.quantity, branchId: line.branchId, size: line.size } })
          : await tx.cartItem.create({ data: { cartId, productId: line.productId, quantity: line.quantity, size: line.size, branchId: line.branchId } });

        if (reservation) {
          await tx.stockReservation.update({
            where: { id: reservation.id },
            data: { quantity: line.quantity, branchId: line.branchId, revision },
          });
        } else {
          await tx.stockReservation.create({
            data: {
              id: reservationId,
              status: ReservationStatus.ACTIVE,
              quantity: line.quantity,
              revision,
              expiresAt: new Date(Date.now() + cartReservationTtlMs()),
              userId,
              productId: line.productId,
              branchId: line.branchId,
              size: line.size,
              cartId,
              cartItemId: savedItem.id,
            },
          });
        }
      });
    }

    for (const step of [...steps].sort(compareVariants)) {
      const effect = { effectId: step.effectId, reason: step.kind === 'take' ? 'CART_RESERVE' : 'CART_RELEASE', refType: 'RESERVATION', refId: step.reservationId };
      if (step.kind === 'take') {
        await this.inventoryService.decrement(tx, step.productId, step.branchId, step.size, step.quantity, effect);
      } else {
        await this.inventoryService.increment(tx, step.productId, step.branchId, step.size, step.quantity, effect);
      }
    }
    for (const run of after) await run();
    await this.inventoryService.syncGlobalStockMany(tx, touched);
  }
}
