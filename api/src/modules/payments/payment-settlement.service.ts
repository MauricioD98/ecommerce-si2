import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  CompensationStatus,
  OrderStatus,
  PaymentAttemptStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  ReservationStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../branches/inventory.service';
import { compareVariants, lockOrder, withTxRetry } from '../../common/checkout/tx.util';
import { toMinorUnits } from '../../common/checkout/checkout-policy';

type Tx = Prisma.TransactionClient;

export type SettleOutcome = 'SETTLED' | 'ALREADY_SETTLED' | 'COMPENSATION';

export interface SettleInput {
  orderId: string;
  method: PaymentMethod;
  transactionId: string;
  currency: string;
  // Solo Stripe: permite distinguir un reintento del mismo cobro de un segundo cobro
  paymentIntentId?: string;
  amountMinor?: number;
}

// Pago exitoso, cancelación y expiración compiten por LA MISMA fila bloqueada: la orden. Quien entra
// primero decide, y el otro ve el estado final. Orden, Payment, reservas y outbox se confirman juntos.
@Injectable()
export class PaymentSettlementService {
  private readonly logger = new Logger(PaymentSettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
  ) {}

  async settle(input: SettleInput): Promise<SettleOutcome> {
    return withTxRetry(() => this.prisma.$transaction((tx) => this.settleInTx(tx, input)));
  }

  async settleInTx(tx: Tx, input: SettleInput): Promise<SettleOutcome> {
    if (!(await lockOrder(tx, input.orderId))) throw new NotFoundException(`Order ${input.orderId} not found`);
    const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId } });

    if (order.paymentStatus === PaymentStatus.COMPLETADO || order.paymentStatus === PaymentStatus.REEMBOLSADO) {
      const sameCharge = !input.paymentIntentId || order.stripePaymentIntentId === input.paymentIntentId;
      if (sameCharge) return 'ALREADY_SETTLED';
      // Ya tiene una liquidación válida: este segundo cobro se devuelve, no se contabiliza
      await this.requestCompensation(tx, order, input, 'DUPLICATE_CHARGE');
      return 'COMPENSATION';
    }

    if (order.status === OrderStatus.CANCELADO) {
      // Cobro tardío de una orden ya liberada: NUNCA se confirma entrega sin stock
      if (input.paymentIntentId) await this.requestCompensation(tx, order, input, 'LATE_PAYMENT');
      return input.paymentIntentId ? 'COMPENSATION' : 'ALREADY_SETTLED';
    }

    await tx.payment.upsert({
      where: { orderId: order.id },
      create: {
        orderId: order.id,
        userId: order.userId,
        amount: order.totalAmount,
        currency: input.currency.toUpperCase(),
        status: PaymentStatus.COMPLETADO,
        paymentMethod: input.method,
        transactionId: input.transactionId,
      },
      update: { status: PaymentStatus.COMPLETADO, paymentMethod: input.method, transactionId: input.transactionId },
    });
    await tx.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: PaymentStatus.COMPLETADO,
        status: OrderStatus.PROCESANDO,
        paymentMethod: input.method,
        cancelRequestedAt: null,
        paymentExpiresAt: null,
        ...(input.paymentIntentId ? { stripePaymentIntentId: input.paymentIntentId } : {}),
      },
    });
    if (input.paymentIntentId) {
      await tx.paymentAttempt.updateMany({
        where: { orderId: order.id, stripePaymentIntentId: input.paymentIntentId },
        data: { status: PaymentAttemptStatus.SUCCEEDED, providerStatus: 'succeeded' },
      });
    }
    await this.enqueue(tx, 'ORDER_PAID_INVOICE', `order-paid-invoice:${order.id}`, { orderId: order.id });
    await this.enqueue(tx, 'ORDER_PAID_PUSH', `order-paid-push:${order.id}`, {
      orderId: order.id,
      userId: order.userId,
      orderNumber: order.orderNumber,
    });
    return 'SETTLED';
  }

  /**
   * Devuelve las unidades de la orden y la deja CANCELADA, una sola vez: cada línea repone con un
   * identificador de efecto único, así que una doble cancelación o un barrido repetido no repone dos veces.
   * false = la orden ya no era cancelable (se pagó o se canceló antes).
   */
  async cancelInTx(tx: Tx, orderId: string, reason: string): Promise<boolean> {
    if (!(await lockOrder(tx, orderId))) return false;
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { orderItems: true } });
    if (order.status !== OrderStatus.PENDIENTE || order.paymentStatus === PaymentStatus.COMPLETADO) return false;

    const lines = order.orderItems
      .map((item) => ({ ...item, productId: item.productId, branchId: order.branchId ?? '', size: item.size ?? '' }))
      .sort(compareVariants);
    for (const line of lines) {
      // Pedidos anteriores a las tallas (o sin sucursal) no tienen dónde reponerse: se registra para revisión
      if (!order.branchId || !line.size) {
        await this.recordIssue(tx, 'CANCEL_WITHOUT_VARIANT', `cancel-without-variant:${line.id}`, { orderId, orderItemId: line.id, quantity: line.quantity });
        continue;
      }
      await this.inventoryService.increment(tx, line.productId, order.branchId, line.size, line.quantity, {
        effectId: `cancel:${line.id}`,
        reason,
        refType: 'ORDER',
        refId: orderId,
      });
    }
    await tx.stockReservation.updateMany({
      where: { orderId, status: ReservationStatus.CONSUMED },
      data: { status: ReservationStatus.RELEASED },
    });
    await tx.paymentAttempt.updateMany({
      where: { orderId, status: { in: [PaymentAttemptStatus.CREATED, PaymentAttemptStatus.OPEN] } },
      data: { status: PaymentAttemptStatus.CANCELED },
    });
    await tx.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.CANCELADO, cancelRequestedAt: null, paymentExpiresAt: null },
    });
    await this.inventoryService.syncGlobalStockMany(tx, lines.map((line) => line.productId));
    await this.enqueue(tx, 'ORDER_CANCELLED_PUSH', `order-cancelled-push:${orderId}`, {
      orderId,
      userId: order.userId,
      orderNumber: order.orderNumber,
    });
    return true;
  }

  async enqueue(tx: Tx, type: string, dedupeKey: string, payload: Prisma.InputJsonValue): Promise<void> {
    await tx.outboxEvent.createMany({ data: [{ type, dedupeKey, payload }], skipDuplicates: true });
  }

  async recordIssue(client: Tx | PrismaService, type: string, dedupeKey: string | null, details: Prisma.InputJsonValue, severity = 'WARN'): Promise<void> {
    await client.operationalIssue.createMany({ data: [{ id: randomUUID(), type, severity, dedupeKey, details }], skipDuplicates: true });
    this.logger.warn(`Anomalía ${type}${dedupeKey ? ` (${dedupeKey})` : ''}`);
  }

  private async requestCompensation(
    tx: Tx,
    order: { id: string; totalAmount: Prisma.Decimal },
    input: SettleInput,
    reason: string,
  ): Promise<void> {
    const currency = input.currency.toLowerCase();
    await tx.paymentCompensation.createMany({
      data: [
        {
          orderId: order.id,
          paymentIntentId: input.paymentIntentId!,
          reason,
          status: CompensationStatus.REQUESTED,
          amountMinor: input.amountMinor ?? toMinorUnits(order.totalAmount, currency),
          currency,
        },
      ],
      skipDuplicates: true,
    });
    await tx.order.update({ where: { id: order.id }, data: { reconciliationStatus: reason } });
    await this.recordIssue(tx, reason, `compensation:${input.paymentIntentId}`, { orderId: order.id, paymentIntentId: input.paymentIntentId }, 'ERROR');
  }
}
