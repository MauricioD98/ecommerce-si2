import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CompensationStatus, OrderSource, OrderStatus, OutboxStatus, PaymentAttemptStatus, PaymentProofStatus, PaymentStatus, Prisma, ReservationStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { InboxStatus } from '../../generated/control/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ControlPrismaService } from '../../tenancy/control-prisma.service';
import { runInTenant, tenantSchemaSql } from '../../tenancy/tenant-context';
import { backgroundJobsEnabled, reconciliationHoldMs } from '../../common/checkout/checkout-policy';
import { failpoint } from '../../common/checkout/failpoints';
import { lockOrder, withTxRetry } from '../../common/checkout/tx.util';
import { PaymentSettlementService } from './payment-settlement.service';
import { PaymentsService } from './payments.service';

const OUTBOX_LEASE_MS = 2 * 60 * 1000;
const OUTBOX_MAX_ATTEMPTS = 10;

// Trabajos persistentes: todo el estado vive en PostgreSQL, así que un reinicio prolongado solo atrasa el
// trabajo. Varias réplicas pueden correr a la vez: el outbox se reclama con SKIP LOCKED + lease, y las
// transiciones de orden se revalidan con la fila bloqueada.
@Injectable()
export class CheckoutMaintenanceService {
  private readonly logger = new Logger(CheckoutMaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly control: ControlPrismaService,
    private readonly payments: PaymentsService,
    private readonly settlement: PaymentSettlementService,
  ) {}

  @Cron('* * * * *')
  async tick(): Promise<void> {
    if (!backgroundJobsEnabled()) return;
    await this.payments.sweepInbox().catch((error) => this.logger.error('Falló el barrido del inbox', error as Error));
    const tenants = await this.control.tenant.findMany({ where: { status: 'ACTIVE' }, select: { id: true, schemaName: true } });
    for (const tenant of tenants) {
      try {
        await runInTenant({ tenantId: tenant.id, schemaName: tenant.schemaName }, () => this.runForCurrentTenant());
      } catch (error) {
        this.logger.error(`Falló el mantenimiento de ${tenant.schemaName}`, error as Error);
      }
    }
  }

  async runForCurrentTenant(): Promise<void> {
    await this.payments.recoverStaleAttempts();
    await this.resolveExpiredOrders();
    await this.payments.processCompensations();
    await this.deliverOutbox();
    await this.warnOnAnomalies();
  }

  // Órdenes vencidas y cancelaciones interrumpidas. Regla: si el resultado del pago es incierto no se libera.
  async resolveExpiredOrders(now = new Date()): Promise<void> {
    const due = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.PENDIENTE,
        source: OrderSource.WEB,
        paymentStatus: { in: [PaymentStatus.PENDIENTE, PaymentStatus.FALLIDO] },
        OR: [
          { cancelRequestedAt: { not: null } },
          // Comprobante en revisión: no vence, decide la tienda
          { paymentExpiresAt: { lt: now }, NOT: { paymentProof: { status: PaymentProofStatus.PENDIENTE } } },
        ],
      },
      select: { id: true, cancelRequestedAt: true },
      take: 100,
    });

    for (const order of due) {
      const provider = await this.payments.resolveProviderBeforeRelease(order.id);
      await failpoint('expiry.afterProviderCheck');
      if (provider === 'PAID') continue;
      if (provider === 'HOLD') {
        await this.holdForReconciliation(order.id);
        continue;
      }
      await withTxRetry(() =>
        this.prisma.$transaction(async (tx) => {
          await lockOrder(tx, order.id);
          // Revalidado con la fila bloqueada: un comprobante pudo llegar entre la lista y este momento
          const fresh = await tx.order.findUniqueOrThrow({
            where: { id: order.id },
            select: { paymentExpiresAt: true, cancelRequestedAt: true, paymentProof: { select: { status: true } } },
          });
          const expired = fresh.paymentExpiresAt !== null && fresh.paymentExpiresAt < now && fresh.paymentProof?.status !== PaymentProofStatus.PENDIENTE;
          if (!expired && !fresh.cancelRequestedAt) return;
          await this.settlement.cancelInTx(tx, order.id, fresh.cancelRequestedAt ? 'ORDER_CANCELLED' : 'ORDER_EXPIRED');
        }),
      );
    }
  }

  private async holdForReconciliation(orderId: string): Promise<void> {
    await this.prisma.order.updateMany({
      where: { id: orderId, status: OrderStatus.PENDIENTE },
      data: { paymentExpiresAt: new Date(Date.now() + reconciliationHoldMs()), reconciliationStatus: 'PROVIDER_UNCERTAIN' },
    });
    await this.settlement.recordIssue(this.prisma, 'PAYMENT_UNCERTAIN', `uncertain:${orderId}`, { orderId });
  }

  // Consumidor del outbox: entrega al menos una vez. Un crash entre el commit de la compra y el envío solo
  // deja el evento PENDING, y un lease vencido lo vuelve a poner en juego.
  async deliverOutbox(now = new Date()): Promise<number> {
    let delivered = 0;
    for (let i = 0; i < 100; i += 1) {
      const event = await this.claimNextEvent(now);
      if (!event) break;
      try {
        await failpoint('outbox.beforeDeliver');
        await this.deliver(event.type, event.payload as Record<string, string>);
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: { status: OutboxStatus.DONE, processedAt: new Date(), leaseUntil: null, lastError: null },
        });
        delivered += 1;
      } catch (error) {
        const attempts = event.attempts;
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: attempts >= OUTBOX_MAX_ATTEMPTS ? OutboxStatus.DEAD : OutboxStatus.PENDING,
            leaseUntil: null,
            nextAttemptAt: new Date(Date.now() + 30_000 * 2 ** Math.min(attempts, 7)),
            lastError: (error instanceof Error ? error.message : String(error)).slice(0, 500),
          },
        });
      }
    }
    return delivered;
  }

  private async claimNextEvent(now: Date) {
    const t = tenantSchemaSql();
    const lease = new Date(now.getTime() + OUTBOX_LEASE_MS);
    const rows = await this.prisma.$queryRaw<{ id: string; type: string; payload: Prisma.JsonValue; attempts: number }[]>`
      UPDATE ${t}."outbox_events" SET "leaseUntil" = ${lease}, "attempts" = "attempts" + 1
      WHERE "id" = (
        SELECT "id" FROM ${t}."outbox_events"
        WHERE "status" = 'PENDING'::${t}."OutboxStatus" AND "nextAttemptAt" <= ${now} AND ("leaseUntil" IS NULL OR "leaseUntil" < ${now})
        ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "type", "payload", "attempts"`;
    return rows[0] ?? null;
  }

  private async deliver(type: string, payload: Record<string, string>): Promise<void> {
    switch (type) {
      case 'ORDER_PAID_INVOICE':
        return this.payments.sendInvoiceEmail(payload.orderId);
      case 'ORDER_PAID_PUSH':
        return this.payments.sendPaidPush(payload.userId, payload.orderId, payload.orderNumber);
      case 'ORDER_CANCELLED_PUSH':
        return this.payments.sendCancelledPush(payload.userId, payload.orderId, payload.orderNumber);
      default:
        throw new Error(`Evento de outbox desconocido: ${type}`);
    }
  }

  // Lo que operación debe mirar. Un número distinto de cero en estos contadores amerita revisión.
  async metrics(now = new Date()) {
    const staleBefore = new Date(now.getTime() - 15 * 60 * 1000);
    const t = tenantSchemaSql();
    const [
      uncertainAttempts,
      expiredReservations,
      pendingCompensations,
      outboxLag,
      outboxDead,
      paidWithoutConsistentOrder,
      openIssues,
      aggregateDrift,
    ] = await Promise.all([
      this.prisma.paymentAttempt.count({ where: { status: { in: [PaymentAttemptStatus.CREATED, PaymentAttemptStatus.OPEN] }, updatedAt: { lt: staleBefore } } }),
      this.prisma.stockReservation.count({ where: { status: ReservationStatus.ACTIVE, expiresAt: { lt: now } } }),
      this.prisma.paymentCompensation.count({ where: { status: { not: CompensationStatus.REFUNDED } } }),
      this.prisma.outboxEvent.count({ where: { status: OutboxStatus.PENDING, nextAttemptAt: { lt: staleBefore } } }),
      this.prisma.outboxEvent.count({ where: { status: OutboxStatus.DEAD } }),
      this.prisma.payment.count({ where: { status: PaymentStatus.COMPLETADO, order: { paymentStatus: { not: PaymentStatus.COMPLETADO } } } }),
      this.prisma.operationalIssue.count({ where: { resolvedAt: null } }),
      this.prisma.$queryRaw<{ n: number }[]>`
        SELECT COUNT(*)::int AS n FROM ${t}."products" p
        WHERE p."stock" <> COALESCE((SELECT SUM(pi."stock") FROM ${t}."product_inventories" pi WHERE pi."productId" = p."id"), 0)`,
    ]);
    const inboxBacklog = await this.control.providerEventInbox.count({
      where: { status: { in: [InboxStatus.PENDING, InboxStatus.UNRESOLVED, InboxStatus.DEAD] }, createdAt: { lt: staleBefore } },
    });
    return {
      uncertainAttempts,
      expiredReservations,
      pendingCompensations,
      outboxLag,
      outboxDead,
      paidWithoutConsistentOrder,
      openIssues,
      aggregateDrift: aggregateDrift[0]?.n ?? 0,
      inboxBacklog,
    };
  }

  private async warnOnAnomalies(): Promise<void> {
    const metrics = await this.metrics();
    const firing = Object.entries(metrics).filter(([name, value]) => value > 0 && name !== 'openIssues');
    if (firing.length > 0) {
      this.logger.warn(`Alerta de compra: ${firing.map(([name, value]) => `${name}=${value}`).join(' ')} [${randomUUID().slice(0, 8)}]`);
    }
  }
}
