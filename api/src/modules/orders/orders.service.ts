import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { currentLanguage, localizedProductName } from '../products/product-translations';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderApiResponseDto, OrderResponseDto } from './dto/order-response.dto';
import { CheckoutAttemptStatus, FulfillmentType, Order, OrderItem, OrderStatus, PaymentAttemptStatus, PaymentMethod, PaymentProofStatus, Product, ReservationStatus, User } from '@prisma/client';
import { i18nMessage } from '../../i18n/i18n-message';
import { QueryOrderDto } from './dto/query-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { BranchesService } from '../branches/branches.service';
import { InventoryService } from '../branches/inventory.service';
import type { AuthUser } from '../../common/decorators/interfaces/request-with-user.interface';
import { hasAllBranches } from '../../common/utils/permission.util';
import { calculateTotals, getBranchPrice, getEmployeeDiscountPercent, round2 } from '../../common/utils/pricing';
import { DELIVERY_SHIPPING_COST } from '../../common/constants/pricing';
import { NotificationsService } from '../notifications/notifications.service';
import { assertPlanFeature } from '../platform/plans';
import { CheckoutCode, CheckoutException } from '../../common/checkout/checkout-errors';
import { MAX_LINE_QUANTITY, orderPaymentTtlMs, simulatedPaymentsEnabled } from '../../common/checkout/checkout-policy';
import { compareVariants, isLockTimeout, lockCart, lockOrder, withTxRetry } from '../../common/checkout/tx.util';
import type { WriteGuard } from '../../common/offline/write-guard';
import { failpoint } from '../../common/checkout/failpoints';
import { tenantSchemaSql } from '../../tenancy/tenant-context';
import { PaymentSettlementService } from '../payments/payment-settlement.service';
import { StripeGateway, isProviderUnavailable } from '../payments/stripe-gateway.service';
import { isWalletReady } from '../payments/payment-settings.service';

const CHECKOUT_OPERATION = 'CREATE_ORDER';
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{16,128}$/;
const CHECKOUT_LOCK_TIMEOUT_MS = 8000;

type NormalizedLine = { productId: string; size: string; quantity: number };

// Líneas repetidas de la misma variante cuentan una sola vez, antes de validar. Orden canónico: el hash no
// depende de cómo el cliente armó el array.
export function normalizeOrderItems(items: { productId: string; size: string; quantity: number }[]): NormalizedLine[] {
  const merged = new Map<string, NormalizedLine>();
  for (const item of items) {
    const key = `${item.productId}|${item.size}`;
    const current = merged.get(key);
    merged.set(key, { productId: item.productId, size: item.size, quantity: (current?.quantity ?? 0) + item.quantity });
  }
  for (const line of merged.values()) {
    if (line.quantity > MAX_LINE_QUANTITY) throw new BadRequestException(`Quantity must not exceed ${MAX_LINE_QUANTITY}`);
  }
  return [...merged.values()].sort((a, b) => (`${a.productId}|${a.size}` < `${b.productId}|${b.size}` ? -1 : 1));
}

export function hashCheckoutPayload(dto: CreateOrderDto, lines: NormalizedLine[]): string {
  const canonical = {
    lines,
    branchId: dto.branchId ?? null,
    fulfillmentType: dto.fulfillmentType ?? FulfillmentType.DELIVERY,
    shippingAddress: dto.shippingAddress ?? null,
    latitude: dto.latitude ?? null,
    longitude: dto.longitude ?? null,
    paymentMethod: dto.paymentMethod ?? null,
    cartVersion: dto.cartVersion,
    expectedTotal: dto.expectedTotal ?? null,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}


// Mensaje claro y específico por estado (no un genérico "tu pedido ahora está X")
const ORDER_STATUS_MESSAGE: Record<OrderStatus, string> = {
  PENDIENTE: 'Tu pedido fue recibido y está pendiente de confirmación.',
  PROCESANDO: 'Tu pedido está siendo preparado.',
  ENVIADO: 'Tu pedido está en camino.',
  ENTREGADO: '¡Tu pedido fue entregado!',
  CANCELADO: 'Tu pedido fue cancelado.',
};

// Comprobante del pago manual sin la imagen (los listados no deben cargar bytea)
const PROOF_SUMMARY_SELECT = { status: true, method: true, txId: true, imageType: true, createdAt: true, reviewedAt: true } as const;
type ProofSummary = { status: PaymentProofStatus; method: PaymentMethod; txId: string | null; imageType: string | null; createdAt: Date; reviewedAt: Date | null };

@Injectable()
export class OrdersService {
    constructor(
        private prisma: PrismaService,
        private branchesService: BranchesService,
        private inventoryService: InventoryService,
        private notificationsService: NotificationsService,
        private settlement: PaymentSettlementService,
        private stripe: StripeGateway,
    ){}

  // Best-effort: una notificación push nunca debe romper el flujo de actualización del pedido
  private notifyStatusChange(order: Order): void {
    this.notificationsService
      .sendPushNotification(order.userId, {
        title: `Pedido ${order.orderNumber}`,
        body: ORDER_STATUS_MESSAGE[order.status],
        url: `/account/orders/${order.id}`,
      })
      .catch(() => undefined);
  }

  // Consulta de recuperación del cliente. 404 NO prueba que la compra no exista: el POST puede seguir en
  // vuelo. El cliente reenvía con la MISMA clave; jamás inicia otra compra por esta sola respuesta.
  async getAttempt(userId: string, key: string) {
    const attempt = await this.prisma.checkoutAttempt.findUnique({
      where: { userId_operation_key: { userId, operation: CHECKOUT_OPERATION, key } },
    });
    if (!attempt) throw new CheckoutException(CheckoutCode.ATTEMPT_NOT_FOUND, HttpStatus.NOT_FOUND);
    return {
      success: true,
      data: {
        key: attempt.key,
        status: attempt.status,
        orderId: attempt.orderId,
        resultCode: attempt.resultCode,
        createdAt: attempt.createdAt,
        updatedAt: attempt.updatedAt,
      },
    };
  }

  // Compra idempotente. Claim del intento, consumo de reservas, orden y resultado se confirman en UNA
  // transacción: no existe un estado intermedio observable ni un hueco por donde duplicar. Un segundo envío
  // con la misma clave choca con el índice único y espera a que el primero termine.
  async create(
    user: AuthUser,
    createOrderDto: CreateOrderDto,
    idempotencyKey?: string,
  ): Promise<OrderApiResponseDto<OrderResponseDto>> {
    // Una app instalada vieja no manda clave: se le exige actualizar en vez de dejarla sin protección
    if (!idempotencyKey || !IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
      throw new CheckoutException(CheckoutCode.IDEMPOTENCY_KEY_REQUIRED, HttpStatus.BAD_REQUEST);
    }
    const userId = user.id;
    const normalized = normalizeOrderItems(createOrderDto.items);
    const payloadHash = hashCheckoutPayload(createOrderDto, normalized);

    // Reintento de un intento ya resuelto: no se revalida nada, se devuelve el resultado original
    const replay = await this.replayAttempt(userId, idempotencyKey, payloadHash);
    if (replay) return replay;

    const { shippingAddress, branchId, latitude, longitude, paymentMethod } = createOrderDto;
        const fulfillmentType = createOrderDto.fulfillmentType ?? FulfillmentType.DELIVERY;
    try {
      if (paymentMethod === PaymentMethod.BANK_QR || paymentMethod === PaymentMethod.QR) {
        assertPlanFeature('qrPayments');
      }
      if (paymentMethod === PaymentMethod.WALLET) {
        assertPlanFeature('digitalWallet');
      }
      if (paymentMethod === PaymentMethod.BANK_QR || paymentMethod === PaymentMethod.USDT || paymentMethod === PaymentMethod.WALLET) {
        await this.assertManualMethodEnabled(paymentMethod as PaymentMethod);
      }
      if (paymentMethod === PaymentMethod.QR && !simulatedPaymentsEnabled()) {
        throw new CheckoutException(CheckoutCode.PAYMENT_SIMULATION_DISABLED, HttpStatus.FORBIDDEN);
      }
      if (paymentMethod === PaymentMethod.BANK_QR || paymentMethod === PaymentMethod.USDT) {
        await this.assertManualMethodEnabled(paymentMethod);
      }

      let targetBranchId = branchId;
      if (!targetBranchId) {
        const defaultBranch = await this.branchesService.findFirstActive();
        if (!defaultBranch) throw new BadRequestException('A branch is required to reserve stock');
        targetBranchId = defaultBranch.id;
      }
      await this.branchesService.findActiveOrFail(targetBranchId);
      // La ubicación de entrega va completa (latitud y longitud) o no va
      if ((latitude === undefined) !== (longitude === undefined)) {
        throw new BadRequestException('latitude and longitude must be sent together');
      }
      const finalBranchId = targetBranchId;
      const method = paymentMethod ?? PaymentMethod.STRIPE;

      const cartId = await this.ensureActiveCartId(userId);
      const orderId = await withTxRetry(() =>
        this.prisma.$transaction(async (tx) => {
          // Si otro proceso retiene el intento o el carrito demasiado tiempo se responde ATTEMPT_IN_PROGRESS,
          // que el cliente recupera con la misma clave, en vez de agotar el timeout de la transacción.
          await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${CHECKOUT_LOCK_TIMEOUT_MS}ms'`);
          const t = tenantSchemaSql();
          const attemptId = randomUUID();
          const claimed = await tx.$executeRaw`
            INSERT INTO ${t}."checkout_attempts" ("id", "userId", "operation", "key", "payloadHash", "status", "cartId", "cartVersion", "updatedAt")
            VALUES (${attemptId}, ${userId}, ${CHECKOUT_OPERATION}, ${idempotencyKey}, ${payloadHash}, 'IN_PROGRESS'::${t}."CheckoutAttemptStatus", ${cartId}, ${createOrderDto.cartVersion}, NOW())
            ON CONFLICT ("userId", "operation", "key") DO NOTHING`;
          // Lo ganó otro envío, que además ya confirmó (el INSERT esperó su commit): se devuelve ese resultado
          if (claimed === 0) return null;
          await failpoint('orders.afterClaim');

          // Carrito leído y validado DENTRO de la transacción, con su fila bloqueada
          await lockCart(tx, cartId);
          const cart = await tx.cart.findUniqueOrThrow({ where: { id: cartId }, select: { version: true } });
          if (cart.version !== createOrderDto.cartVersion) {
            throw new CheckoutException(CheckoutCode.CART_VERSION_CONFLICT, HttpStatus.CONFLICT, {}, { currentVersion: cart.version });
          }
          const items = await tx.cartItem.findMany({ where: { cartId }, include: { reservation: true } });
          const itemByVariant = new Map(items.map((item) => [`${item.productId}|${item.size ?? ''}`, item]));

          // Precios siempre del servidor (descuento de la sucursal), nunca los del cliente
          const products = await tx.product.findMany({ where: { id: { in: [...new Set(normalized.map((line) => line.productId))] } } });
          const productById = new Map(products.map((product) => [product.id, product]));
          const discounts = await tx.productInventory.findMany({ where: { branchId: finalBranchId, productId: { in: products.map((p) => p.id) } } });
          const discountByProduct = new Map(discounts.map((row) => [row.productId, row]));

          const lines = normalized.map((line) => {
            const product = productById.get(line.productId);
            if (!product || !product.isActive) throw new NotFoundException(`Product with ID ${line.productId} not found`);
            if (!product.sizes.includes(line.size)) {
              throw new BadRequestException(`Invalid size for product ${product.name}. Available: ${product.sizes.join(', ')}`);
            }
            return { ...line, branchId: finalBranchId, unitPrice: getBranchPrice(product, discountByProduct.get(line.productId) ?? null) };
          });

          const buyer = await tx.user.findUnique({ where: { id: userId }, select: { employeeDiscount: true } });
          const { discountApplied, total: itemsTotal } = calculateTotals(lines, getEmployeeDiscountPercent(buyer ?? { employeeDiscount: 0 }));
          // Envío a domicilio suma un costo fijo (no se descuenta); retiro en sucursal no tiene costo de envío
          const shippingCost = fulfillmentType === FulfillmentType.DELIVERY ? DELIVERY_SHIPPING_COST : 0;
          const total = round2(itemsTotal + shippingCost);
          if (createOrderDto.expectedTotal !== undefined && round2(createOrderDto.expectedTotal) !== total) {
            throw new CheckoutException(CheckoutCode.PRICE_CHANGED, HttpStatus.CONFLICT, {}, { currentTotal: total });
          }

          const now = new Date();
          const newOrder = await tx.order.create({
            data: {
              userId,
              status: OrderStatus.PENDIENTE,
              totalAmount: total,
              discountApplied,
              shippingCost,
              paymentMethod: method,
              paymentExpiresAt: new Date(now.getTime() + orderPaymentTtlMs(method)),
              fulfillmentType,
              branchId: finalBranchId,
              shippingAddress,
              // La ubicación solo tiene sentido en envíos a domicilio
              ...(fulfillmentType === FulfillmentType.DELIVERY ? { latitude, longitude } : {}),
              cartId,
              orderItems: {
                create: lines.map((line) => ({
                  product: { connect: { id: line.productId } },
                  quantity: line.quantity,
                  price: line.unitPrice,
                  size: line.size,
                })),
              },
            },
          });

          // Stock: transferir la reserva a la orden NO descuenta de nuevo. Solo se mueve la diferencia, en el
          // orden único de bloqueos. Una línea agotada revierte toda la transacción: nada a medias.
          type Step = { take: boolean; productId: string; branchId: string; size: string; quantity: number; effectId: string };
          const steps: Step[] = [];
          for (const line of lines) {
            const item = itemByVariant.get(`${line.productId}|${line.size}`);
            const reservation = item?.reservation?.status === ReservationStatus.ACTIVE ? item.reservation : null;
            if (reservation?.expiresAt && reservation.expiresAt < now) {
              throw new CheckoutException(CheckoutCode.RESERVATION_EXPIRED);
            }
            const effect = (suffix: string) => `checkout:${newOrder.id}:${line.productId}:${line.size}:${suffix}`;
            const consumedHere = reservation?.branchId === finalBranchId ? reservation.quantity : 0;
            if (reservation && consumedHere === 0) {
              // Reservado en otra sucursal: se libera el origen y se descuenta del destino
              steps.push({ take: false, productId: line.productId, branchId: reservation.branchId, size: line.size, quantity: reservation.quantity, effectId: effect('release-origin') });
            }
            if (line.quantity > consumedHere) {
              steps.push({ take: true, productId: line.productId, branchId: finalBranchId, size: line.size, quantity: line.quantity - consumedHere, effectId: effect('take') });
            } else if (line.quantity < consumedHere) {
              steps.push({ take: false, productId: line.productId, branchId: finalBranchId, size: line.size, quantity: consumedHere - line.quantity, effectId: effect('release-extra') });
            }

            // Solo se toca lo capturado por esta orden: otras líneas del carrito siguen reservadas
            if (reservation) {
              await tx.stockReservation.update({
                where: { id: reservation.id },
                data: {
                  status: ReservationStatus.CONSUMED,
                  orderId: newOrder.id,
                  cartItemId: null,
                  expiresAt: null,
                  quantity: line.quantity,
                  branchId: finalBranchId,
                  revision: { increment: 1 },
                },
              });
            } else {
              await tx.stockReservation.create({
                data: {
                  status: ReservationStatus.CONSUMED,
                  quantity: line.quantity,
                  userId,
                  productId: line.productId,
                  branchId: finalBranchId,
                  size: line.size,
                  cartId,
                  orderId: newOrder.id,
                },
              });
            }
            if (item) await tx.cartItem.delete({ where: { id: item.id } });
          }
          for (const step of steps.sort(compareVariants)) {
            const effect = { effectId: step.effectId, reason: step.take ? 'CHECKOUT_TAKE' : 'CHECKOUT_RELEASE', refType: 'ORDER', refId: newOrder.id };
            if (step.take) await this.inventoryService.decrement(tx, step.productId, step.branchId, step.size, step.quantity, effect);
            else await this.inventoryService.increment(tx, step.productId, step.branchId, step.size, step.quantity, effect);
          }

          await tx.cart.update({ where: { id: cartId }, data: { version: { increment: 1 } } });
          await tx.checkoutAttempt.update({
            where: { id: attemptId },
            data: { status: CheckoutAttemptStatus.SUCCEEDED, orderId: newOrder.id },
          });
          await this.inventoryService.syncGlobalStockMany(tx, steps.map((step) => step.productId));
          await failpoint('orders.beforeCommit');
          return newOrder.id;
        }),
      );

      if (orderId === null) {
        const again = await this.replayAttempt(userId, idempotencyKey, payloadHash);
        if (again) return again;
        throw new CheckoutException(CheckoutCode.ATTEMPT_IN_PROGRESS);
      }
      await failpoint('orders.afterCommit');
      return this.wrap(await this.loadOrder(orderId));
    } catch (error) {
      if (isLockTimeout(error)) throw new CheckoutException(CheckoutCode.ATTEMPT_IN_PROGRESS);
      // Solo un rechazo de negocio es definitivo para esta clave. Un fallo transitorio no se registra: el
      // cliente reintenta con la misma clave y el protocolo sigue siendo seguro.
      if (error instanceof HttpException && error.getStatus() < 500 && !(error instanceof CheckoutException && error.code === CheckoutCode.ATTEMPT_IN_PROGRESS)) {
        await this.recordRejection(userId, idempotencyKey, payloadHash, error);
        const winner = await this.replayAttempt(userId, idempotencyKey, payloadHash, true);
        if (winner) return winner;
      }
      throw error;
    }
  }

  private async ensureActiveCartId(userId: string): Promise<string> {
    const t = tenantSchemaSql();
    await this.prisma.$executeRaw`
      INSERT INTO ${t}."carts" ("id", "userId", "activeUserId", "updatedAt")
      VALUES (${randomUUID()}, ${userId}, ${userId}, NOW())
      ON CONFLICT ("activeUserId") DO NOTHING`;
    const cart = await this.prisma.cart.findUniqueOrThrow({ where: { activeUserId: userId }, select: { id: true } });
    return cart.id;
  }

  private async recordRejection(userId: string, key: string, payloadHash: string, error: HttpException): Promise<void> {
    const body = error.getResponse() as { code?: string; message?: unknown };
    const code = error instanceof CheckoutException ? error.code : (body?.code ?? `HTTP_${error.getStatus()}`);
    const message = typeof body === 'string' ? body : typeof body?.message === 'string' ? body.message : null;
    await this.prisma.checkoutAttempt.createMany({
      data: [{ userId, operation: CHECKOUT_OPERATION, key, payloadHash, status: CheckoutAttemptStatus.REJECTED, resultCode: code, resultMessage: message }],
      skipDuplicates: true,
    });
  }

  // Misma clave + mismo payload: resultado original. Misma clave + otro payload: 409, sin efectos.
  private async replayAttempt(userId: string, key: string, payloadHash: string, onlySucceeded = false) {
    const attempt = await this.prisma.checkoutAttempt.findUnique({
      where: { userId_operation_key: { userId, operation: CHECKOUT_OPERATION, key } },
    });
    if (!attempt) return null;
    if (onlySucceeded && attempt.status !== CheckoutAttemptStatus.SUCCEEDED) return null;
    if (attempt.payloadHash !== payloadHash) {
      throw new CheckoutException(CheckoutCode.IDEMPOTENCY_KEY_REUSED);
    }
    if (attempt.status === CheckoutAttemptStatus.SUCCEEDED && attempt.orderId) {
      return { ...this.wrap(await this.loadOrder(attempt.orderId)), replayed: true };
    }
    if (attempt.status === CheckoutAttemptStatus.REJECTED) {
      // El mismo intento rechazado sigue rechazado: comprar de nuevo exige revisar y una clave nueva
      throw new HttpException(
        { code: attempt.resultCode, message: attempt.resultMessage ?? i18nMessage('errors.CART_VERSION_CONFLICT') },
        attempt.resultCode?.startsWith('HTTP_') ? Number(attempt.resultCode.slice(5)) : HttpStatus.CONFLICT,
      );
    }
    return null;
  }

  private loadOrder(id: string) {
    return this.prisma.order.findUniqueOrThrow({
      where: { id },
      include: {
        orderItems: { include: { product: true } },
        user: true,
        paymentProof: { select: PROOF_SUMMARY_SELECT },
      },
    });
  }

  async findAllForAdmin(query: QueryOrderDto, actor?: AuthUser): Promise<{
  data: OrderResponseDto[];
  total: number;
  page: number;
  limit: number;
}> {
  const { page = 1, limit = 10, status, search } = query;
  const skip = (page - 1) * limit;

const where: any = {};
this.applyBranchScope(where, actor);
if (status) where.status = status;
if (search) where.OR = [{ id: { contains: search, mode: 'insensitive' } },
  {orderNumber:{contains: search, mode:'insensitive'}},
];

  const [orders, total] = await Promise.all([
  this.prisma.order.findMany({
    where,
    skip,
    take: limit,
    include: {
      orderItems: {
        include: {
          product: true,
        },
      },
      user: true,
      paymentProof: { select: PROOF_SUMMARY_SELECT },
    },
    orderBy:{createdAt:'desc'},
  }),

  this.prisma.order.count({where}),

]);

return {
  data: orders.map((o) => this.map(o)),
  total,
  page,
  limit
}

}


async findAll(
  userId: string,
  query: QueryOrderDto,
): Promise<{
  data: OrderResponseDto[];
  total: number;
  page: number;
  limit: number;
}> {

  const { page = 1, limit = 10, status, search } = query;
  const skip = (page - 1) * limit;

  const where: any = { userId };
  if (status) where.status = status;
  if (search) where.OR = [{ id: { contains: search, mode: 'insensitive' } }];

  const [orders, total] = await Promise.all([
  this.prisma.order.findMany({
    where,
    skip,
    take: limit,
    include: {
      orderItems: {
        include: {
          product: true,
        },
      },
        user:true,
        paymentProof: { select: PROOF_SUMMARY_SELECT },
    },
      orderBy:{ createdAt:'desc'},
  }),
    this.prisma.order.count({where}),
]);

  return {
  data: orders.map((o) => this.map(o)),
  total,
  page,
  limit,
};

}


async findOne(id: string, userId?: string, actor?: AuthUser): Promise<OrderApiResponseDto<OrderResponseDto>> {

  const where: any = { id }
  if (userId) where.userId = userId;
  this.applyBranchScope(where, actor);

  const order = await this.prisma.order.findFirst({
    where,
    include: {
      orderItems: {
        include: {
          product: true
        },
      },
      user:true,
      paymentProof: { select: PROOF_SUMMARY_SELECT },
    },
  });

  if (!order) {
  throw new NotFoundException(`Order with ID ${id} not found`);
  }
    return this.wrap(order);
}


async update(
  id: string,
  updateOrderDto: UpdateOrderDto,
  userId?: string,
  actor?: AuthUser,
  guard?: WriteGuard<Order>,
): Promise<OrderApiResponseDto<OrderResponseDto>> {
  const where: any = { id };
  if (userId) where.userId = userId;
  this.applyBranchScope(where, actor);

  // El cliente no gestiona la logística de su propio pedido: marcarlo ENVIADO o PROCESANDO saltearía el pago
  if (userId && updateOrderDto.status) {
    throw new ForbiddenException('Only staff can change the status of an order');
  }
  // Cancelar repone stock y resuelve el pago: nunca como un simple cambio de columna
  if (updateOrderDto.status === OrderStatus.CANCELADO) {
    return this.cancel(id, userId, actor);
  }

  const { before, updated } = await withTxRetry(() =>
    this.prisma.$transaction(async (tx) => {
      await lockOrder(tx, id);
      const existing = await tx.order.findFirst({ where });
      if (!existing) throw new NotFoundException(`Order ${id} not found`);
      // Una orden cancelada ya devolvió sus unidades: revivirla las vendería dos veces
      if (updateOrderDto.status && existing.status === OrderStatus.CANCELADO) {
        throw new BadRequestException('A cancelled order cannot change status');
      }
      // Cambio hecho sin conexión: el estado sigue como lo vio el dispositivo (la orden ya está bloqueada)
      if (guard) await guard(tx, existing);
      const saved = await tx.order.update({
        where: { id },
        data: updateOrderDto.status ? { status: updateOrderDto.status } : {},
        include: {
          orderItems: { include: { product: true } },
          user: true,
          paymentProof: { select: PROOF_SUMMARY_SELECT },
        },
      });
      return { before: existing, updated: saved };
    }),
  );

  if (updateOrderDto.status && updateOrderDto.status !== before.status) {
    this.notifyStatusChange(updated);
  }

  return this.wrap(updated);

 }


// Pago, cancelación y expiración compiten por la misma fila. Si hay un cobro iniciado: (1) se persiste la
// intención, (2) se cancela en el proveedor FUERA de la transacción, (3) se aplica el resultado. Tras un
// crash entre pasos, CheckoutMaintenanceService retoma la intención persistida.
async cancel(
  id: string,
  userId?: string,
  actor?: AuthUser,
): Promise<OrderApiResponseDto<OrderResponseDto>> {
  const where: any = { id };
  if (userId) where.userId = userId;
  this.applyBranchScope(where, actor);

  const openAttempt = await withTxRetry(() =>
    this.prisma.$transaction(async (tx) => {
      await lockOrder(tx, id);
      const order = await tx.order.findFirst({ where });
      if (!order) throw new NotFoundException(`Order ${id} not found`);
      if (order.status !== OrderStatus.PENDIENTE) throw new BadRequestException('Only pending orders can be cancelled');
      await tx.order.update({ where: { id }, data: { cancelRequestedAt: new Date() } });
      return tx.paymentAttempt.findFirst({
        where: { orderId: id, status: { in: [PaymentAttemptStatus.CREATED, PaymentAttemptStatus.OPEN] } },
      });
    }),
  );

  await failpoint('orders.cancel.afterIntent');
  if (openAttempt?.stripePaymentIntentId) {
    await this.cancelAtProvider(id, openAttempt.stripePaymentIntentId, openAttempt.id);
  }

  const cancelled = await withTxRetry(() =>
    this.prisma.$transaction((tx) => this.settlement.cancelInTx(tx, id, 'ORDER_CANCELLED')),
  );
  if (!cancelled) throw new BadRequestException('Only pending orders can be cancelled');
  return this.wrap(await this.loadOrder(id));
}

// Si el cobro ya terminó o sigue procesándose, NO se cancela: el dinero del cliente manda
private async cancelAtProvider(orderId: string, paymentIntentId: string, attemptId: string): Promise<void> {
  try {
    await this.stripe.cancel(paymentIntentId, `sf-cancel-${attemptId}`);
  } catch (error) {
    if (isProviderUnavailable(error)) {
      // Incierto: se conserva la intención y el stock. El barrido reintentará
      throw new CheckoutException(CheckoutCode.PROVIDER_UNAVAILABLE, HttpStatus.SERVICE_UNAVAILABLE);
    }
    const intent = await this.stripe.retrieve(paymentIntentId);
    if (intent.status === 'canceled') return;
    if (intent.status === 'succeeded') {
      await this.settlement.settle({
        orderId,
        method: PaymentMethod.STRIPE,
        transactionId: intent.id,
        currency: intent.currency,
        paymentIntentId: intent.id,
        amountMinor: intent.amount,
      });
      throw new CheckoutException(CheckoutCode.ORDER_ALREADY_PAID);
    }
    if (intent.status === 'processing') {
      throw new CheckoutException(CheckoutCode.PAYMENT_PENDING, HttpStatus.CONFLICT, {}, { providerStatus: intent.status });
    }
    throw error;
  }
}


  // QR bancario, USDT o billetera solo si la tienda los activó (y completó) en Gestión de pagos
  private async assertManualMethodEnabled(method: PaymentMethod): Promise<void> {
    const settings = await this.prisma.paymentSettings.findUnique({
      where: { id: 'default' },
      select: { qrEnabled: true, qrImageType: true, usdtEnabled: true, usdtNetwork: true, usdtWalletAddress: true, walletEnabled: true, walletProvider: true, walletAccount: true },
    });
    const enabled =
      method === PaymentMethod.BANK_QR
        ? Boolean(settings?.qrEnabled && settings.qrImageType)
        : method === PaymentMethod.USDT
        ? Boolean(settings?.usdtEnabled && settings.usdtNetwork && settings.usdtWalletAddress)
        : isWalletReady(settings);
    if (!enabled) throw new BadRequestException(i18nMessage('errors.PAYMENT_METHOD_UNAVAILABLE'));
  }

  // Sin el permiso ALL_BRANCHES solo se ven/gestionan pedidos de la sucursal propia
  private applyBranchScope(where: any, actor?: AuthUser): void {
    if (!actor || hasAllBranches(actor)) return;
    if (!actor.branchId) {
      throw new ForbiddenException('User is not assigned to a branch');
    }
    where.branchId = actor.branchId;
  }

  private wrap(
    order: Order &{
      orderItems: (OrderItem &{ product: Product})[];
      user:User; 
      paymentProof?: ProofSummary | null;
    },
  ): OrderApiResponseDto<OrderResponseDto> {
  return {
    success: true,
    message: 'Order retreived successfully',
    data: this.map(order),
  };
}

private map(order: Order & { orderItems: (OrderItem &{ product: Product})[];
  user:User; 
  paymentProof?: ProofSummary | null;
  },
): OrderResponseDto {
  // Una sola lectura del idioma por pedido, no una por línea
  const language = currentLanguage();
  return {
    id: order.id,
    userId: order.userId,
    status: order.status,
    paymentStatus: order.paymentStatus,
    total: Number(order.totalAmount),
    shippingCost: Number(order.shippingCost),
    shippingAddress: order.shippingAddress ?? '',
    fulfillmentType: order.fulfillmentType,
    latitude: order.latitude,
    longitude: order.longitude,
    branchId: order.branchId,
    discountApplied: Number(order.discountApplied),
    source: order.source,
    paymentMethod: order.paymentMethod,
    paymentProof: order.paymentProof
      ? {
          status: order.paymentProof.status,
          method: order.paymentProof.method,
          txId: order.paymentProof.txId,
          hasImage: Boolean(order.paymentProof.imageType),
          createdAt: order.paymentProof.createdAt,
          reviewedAt: order.paymentProof.reviewedAt,
        }
      : null,
    cashierId: order.cashierId,
    items: order.orderItems.map((item) => ({
      id: item.id,
      productId: item.productId,
      // En el idioma del request; el pedido guardado no cambia (OrderItem no copia el nombre)
      productName: localizedProductName(item.product, language),
      size: item.size,
      quantity: item.quantity,
      price: Number(item.price),
      subtotal: Number(item.price) * item.quantity,
      createdAt: order.createdAt,
      updateAt: order.updatedAt,
    })),

    ...(order.user && {
  userEmail: order.user.email,
  userName:
    `${order.user.firstName || ''} ${order.user.lastName || ''}`.trim(),
  }),
  createdAt: order.createdAt,
  updateAt: order.updatedAt,
  };
}
  
}
