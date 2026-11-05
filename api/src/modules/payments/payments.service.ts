import { randomUUID } from 'node:crypto';
import { BadRequestException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';
import { InboxStatus } from '../../generated/control/client';
import { CompensationStatus, OrderStatus, PaymentAttemptStatus, PaymentMethod, PaymentStatus, Prisma } from '@prisma/client';
import * as QRCode from 'qrcode';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { CreatePaymentIntentResponse, PaymentResponseDto } from './dto/payment-response.dto';
import { ConfirmPaymentDto } from './dto/confirm-payment.dto';
import { InvoiceService } from '../invoices/invoice.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StripeConnectService } from './stripe-connect.service';
import { SubscriptionsService } from '../platform/subscriptions.service';
import { requireTenant, runInTenant, withTenantParam } from '../../tenancy/tenant-context';
import { assertPlanFeature } from '../platform/plans';
import { ControlPrismaService } from '../../tenancy/control-prisma.service';
import { CheckoutCode, CheckoutException } from '../../common/checkout/checkout-errors';
import { STRIPE_IDEMPOTENCY_HORIZON_MS, paymentCurrency, simulatedPaymentsEnabled, toMinorUnits } from '../../common/checkout/checkout-policy';
import { lockOrder, withTxRetry } from '../../common/checkout/tx.util';
import { failpoint } from '../../common/checkout/failpoints';
import { PaymentSettlementService } from './payment-settlement.service';
import { StripeGateway, isProviderUnavailable } from './stripe-gateway.service';

const INBOX_LEASE_MS = 2 * 60 * 1000;
const INBOX_MAX_ATTEMPTS = 25;
const INTENT_REUSABLE = new Set<string>(['requires_payment_method', 'requires_confirmation', 'requires_action']);
const INTENT_EXPIRY_GRACE_MS = 15 * 60 * 1000;


@Injectable()
export class PaymentsService {
    private readonly logger = new Logger(PaymentsService.name);

    constructor(
        private prisma: PrismaService,
        private invoiceService: InvoiceService,
        private mailService: MailService,
        private notificationsService: NotificationsService,
        private stripeConnect: StripeConnectService,
        private subscriptions: SubscriptionsService,
        private control: ControlPrismaService,
        private settlement: PaymentSettlementService,
        private gateway: StripeGateway,
    ) {}

    // Una orden tiene una sola liquidación válida. Protocolo:
    //  1. Transacción corta: orden bloqueada, intento durable con importe/moneda/destino inmutables.
    //  2. FUERA de la transacción: Stripe con clave idempotente derivada de tienda + orden + intento.
    //  3. Se guarda el id del PaymentIntent. Si la API cae entre 2 y 3, reintentar repite la misma clave y
    //     Stripe devuelve el MISMO PaymentIntent; el webhook y el barrido también pueden enlazarlo.
    async createPaymentIntent(
    userId: string,
    createPaymentIntentDto: CreatePaymentIntentDto,
  ): Promise<{
    success: boolean;
    data: CreatePaymentIntentResponse;
    message: string;
  }> {
    const { orderId } = createPaymentIntentDto;
    const { tenantId } = requireTenant();
    const legacyId = process.env.LEGACY_TENANT_ID;
    const isLegacy = Boolean(legacyId && tenantId === legacyId);
    const isTestKey = Boolean(process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_'));
    const payout = await this.stripeConnect.getPayoutAccountOrNull(tenantId);
    if (!payout && !isLegacy && !isTestKey) {
      throw new BadRequestException('Esta tienda todavía no tiene habilitados los pagos con tarjeta');
    }

    for (let round = 0; round < 3; round += 1) {
      const { attempt, payment } = await withTxRetry(() =>
        this.prisma.$transaction(async (tx) => {
          if (!(await lockOrder(tx, orderId))) throw new NotFoundException(`Order with ID ${orderId} not found`);
          const order = await tx.order.findFirst({ where: { id: orderId, userId } });
          if (!order) throw new NotFoundException(`Order with ID ${orderId} not found`);
          this.assertOrderPayable(order);

          let current = await tx.paymentAttempt.findFirst({
            where: { orderId, status: { in: [PaymentAttemptStatus.CREATED, PaymentAttemptStatus.OPEN] } },
          });
          if (!current) {
            // El monto SIEMPRE se calcula desde la orden guardada: nunca se confía en el cliente
            const currency = paymentCurrency();
            const amountMinor = toMinorUnits(order.totalAmount, currency);
            const attemptNumber = (await tx.paymentAttempt.count({ where: { orderId } })) + 1;
            const id = randomUUID();
            current = await tx.paymentAttempt.create({
              data: {
                id,
                orderId,
                userId,
                attemptNumber,
                amountMinor,
                currency,
                destinationAccount: payout?.accountId ?? null,
                feeAmountMinor: payout ? this.stripeConnect.feeFor(amountMinor, payout.feeBps) : null,
                idempotencyKey: `sf-pi-${tenantId}-${orderId}-${id}`,
              },
            });
          }
          const saved = await tx.payment.upsert({
            where: { orderId },
            create: {
              orderId,
              userId,
              amount: order.totalAmount,
              currency: current.currency,
              status: PaymentStatus.PENDIENTE,
              paymentMethod: 'STRIPE',
              transactionId: current.stripePaymentIntentId,
            },
            update: { amount: order.totalAmount, currency: current.currency, paymentMethod: 'STRIPE' },
          });
          // El cliente ya está pagando: margen para que no venza mientras escribe su tarjeta
          const minimumExpiry = new Date(Date.now() + INTENT_EXPIRY_GRACE_MS);
          await tx.order.update({
            where: { id: orderId },
            data: {
              paymentMethod: PaymentMethod.STRIPE,
              ...(order.paymentExpiresAt && order.paymentExpiresAt < minimumExpiry ? { paymentExpiresAt: minimumExpiry } : {}),
            },
          });
          return { attempt: current, payment: saved };
        }),
      );
      await failpoint('payments.afterAttemptPersisted');

      const intent = await this.obtainIntent(attempt);
      if (intent === 'RETRY') continue;

      if (intent.status === 'succeeded') {
        await this.reconcileIntent(intent);
        throw new CheckoutException(CheckoutCode.ORDER_ALREADY_PAID);
      }
      if (intent.status === 'processing') {
        throw new CheckoutException(CheckoutCode.PAYMENT_PENDING, HttpStatus.CONFLICT, {}, { providerStatus: intent.status });
      }
      if (!INTENT_REUSABLE.has(intent.status)) continue;

      return {
        success: true,
        data: {
          // client_secret nunca se persiste: se pide a Stripe en cada recuperación
          clientSecret: intent.client_secret!,
          paymentId: payment.id,
          paymentIntentId: intent.id,
          status: intent.status,
        },
        message: 'Payment intent ready',
      };
    }
    throw new CheckoutException(CheckoutCode.ATTEMPT_IN_PROGRESS);
  }

  private assertOrderPayable(order: { status: OrderStatus; paymentStatus: PaymentStatus; paymentExpiresAt: Date | null; cancelRequestedAt: Date | null }): void {
    if (order.paymentStatus === PaymentStatus.COMPLETADO || order.paymentStatus === PaymentStatus.REEMBOLSADO) {
      throw new CheckoutException(CheckoutCode.ORDER_ALREADY_PAID);
    }
    if (order.status !== OrderStatus.PENDIENTE || order.cancelRequestedAt) {
      throw new CheckoutException(CheckoutCode.ORDER_NOT_PAYABLE);
    }
    if (order.paymentExpiresAt && order.paymentExpiresAt < new Date()) {
      throw new CheckoutException(CheckoutCode.RESERVATION_EXPIRED);
    }
  }

  // Recupera el PaymentIntent del intento durable o lo crea. 'RETRY' = este intento ya terminó: hace falta otro.
  private async obtainIntent(attempt: {
    id: string;
    orderId: string;
    userId: string;
    status: PaymentAttemptStatus;
    amountMinor: number;
    currency: string;
    destinationAccount: string | null;
    feeAmountMinor: number | null;
    idempotencyKey: string;
    stripePaymentIntentId: string | null;
    createdAt: Date;
  }): Promise<Stripe.PaymentIntent | 'RETRY'> {
    if (attempt.stripePaymentIntentId) {
      const existing = await this.callProvider(() => this.gateway.retrieve(attempt.stripePaymentIntentId!));
      if (existing.status !== 'canceled') return existing;
      await this.prisma.paymentAttempt.updateMany({
        where: { id: attempt.id, status: PaymentAttemptStatus.OPEN },
        data: { status: PaymentAttemptStatus.CANCELED, providerStatus: 'canceled' },
      });
      return 'RETRY';
    }

    // Fuera del horizonte de idempotencia la misma clave podría crear otro cobro: se concilia primero
    if (Date.now() - attempt.createdAt.getTime() > STRIPE_IDEMPOTENCY_HORIZON_MS) {
      const found = await this.callProvider(() => this.gateway.findByAttempt(attempt.id));
      if (found) {
        await this.linkIntent(attempt.id, found);
        return found;
      }
      await this.prisma.paymentAttempt.updateMany({
        where: { id: attempt.id, status: PaymentAttemptStatus.CREATED },
        data: { status: PaymentAttemptStatus.ABANDONED },
      });
      return 'RETRY';
    }

    const { tenantId } = requireTenant();
    const intent = await this.callProvider(() =>
      this.gateway.createPaymentIntent(
        {
          amount: attempt.amountMinor,
          currency: attempt.currency,
          // metadata.tenantId es lo que usa el webhook para saber en qué schema está la orden
          metadata: { orderId: attempt.orderId, userId: attempt.userId, tenantId, attemptId: attempt.id },
          automatic_payment_methods: { enabled: true },
          // La tienda figura como comerciante (extracto bancario del cliente, disputas, liquidación)
          on_behalf_of: attempt.destinationAccount ?? undefined,
          transfer_data: attempt.destinationAccount ? { destination: attempt.destinationAccount } : undefined,
          application_fee_amount: attempt.feeAmountMinor ?? undefined,
        },
        attempt.idempotencyKey,
      ),
    );
    await failpoint('payments.afterProviderCreate');
    await this.linkIntent(attempt.id, intent);
    return intent;
  }

  private async linkIntent(attemptId: string, intent: Stripe.PaymentIntent): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const attempt = await tx.paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
      await lockOrder(tx, attempt.orderId);
      const fresh = await tx.paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
      const stillOpen = fresh.status === PaymentAttemptStatus.CREATED || fresh.status === PaymentAttemptStatus.OPEN;
      await tx.paymentAttempt.update({
        where: { id: attemptId },
        data: {
          stripePaymentIntentId: intent.id,
          livemode: intent.livemode,
          providerStatus: intent.status,
          ...(stillOpen ? { status: PaymentAttemptStatus.OPEN } : {}),
        },
      });
      await tx.payment.updateMany({ where: { orderId: attempt.orderId, status: { not: PaymentStatus.COMPLETADO } }, data: { transactionId: intent.id } });
      await tx.order.updateMany({ where: { id: attempt.orderId, paymentStatus: { not: PaymentStatus.COMPLETADO } }, data: { stripePaymentIntentId: intent.id } });
    });
  }

  // Un timeout o 5xx del proveedor no prueba nada sobre lo que hizo: se informa como reintentable
  private async callProvider<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === 'idempotency_key_in_use') throw new CheckoutException(CheckoutCode.ATTEMPT_IN_PROGRESS);
      if (isProviderUnavailable(error)) throw new CheckoutException(CheckoutCode.PROVIDER_UNAVAILABLE, HttpStatus.SERVICE_UNAVAILABLE);
      throw error;
    }
  }

  // Solo reconcilia con evidencia del proveedor: el cliente nunca puede marcar nada como pagado.
  // `processing` y `requires_action` siguen pendientes (409 PAYMENT_PENDING).
  async confirmPayment(
    userId: string,
    confirmPaymentDto: ConfirmPaymentDto,
  ): Promise<{ success: boolean; data: PaymentResponseDto; message: string }> {
    const { paymentIntentId, orderId } = confirmPaymentDto;

    const order = await this.prisma.order.findFirst({ where: { id: orderId, userId }, select: { id: true } });
    if (!order) throw new NotFoundException('payment not found');

    // Pago manual o QR simulado: esta ruta no confirma nada, solo informa el estado real
    if (!paymentIntentId.startsWith('pi_')) {
      const local = await this.prisma.payment.findFirst({ where: { orderId, userId } });
      if (local?.status === PaymentStatus.COMPLETADO) {
        return { success: true, data: this.mapToPaymentResponse(local), message: 'Payment confirmed successfully' };
      }
      throw new CheckoutException(CheckoutCode.PAYMENT_PENDING);
    }

    const attempt = await this.prisma.paymentAttempt.findFirst({ where: { orderId, userId, stripePaymentIntentId: paymentIntentId } });
    let intent = await this.callProvider(() => this.gateway.retrieve(paymentIntentId));
    // Demostración sin SDK nativo (app móvil): nunca en producción, ver simulatedPaymentsEnabled()
    if (attempt && intent.status === 'requires_payment_method' && (simulatedPaymentsEnabled() || process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_'))) {
      const publicUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
      intent = await this.callProvider(() =>
        this.gateway.client.paymentIntents.confirm(paymentIntentId, {
          payment_method: 'pm_card_visa',
          return_url: withTenantParam(`${publicUrl}/checkout/success?orderId=${orderId}`),
        }),
      );
    }
    if (!attempt && intent.metadata?.attemptId) {
      const pending = await this.prisma.paymentAttempt.findFirst({ where: { id: intent.metadata.attemptId, orderId, userId } });
      if (!pending) {
        await this.auditMismatch(intent, 'INTENT_NOT_OF_THIS_ORDER', { orderId, userId });
        throw new CheckoutException(CheckoutCode.PAYMENT_MISMATCH);
      }
    } else if (!attempt) {
      await this.auditMismatch(intent, 'INTENT_NOT_OF_THIS_ORDER', { orderId, userId });
      throw new CheckoutException(CheckoutCode.PAYMENT_MISMATCH);
    }

    const outcome = await this.reconcileIntent(intent, { orderId, userId });
    if (outcome === 'MISMATCH') throw new CheckoutException(CheckoutCode.PAYMENT_MISMATCH);
    if (outcome === 'COMPENSATION') throw new CheckoutException(CheckoutCode.ORDER_NOT_PAYABLE);
    if (outcome === 'PENDING') {
      throw new CheckoutException(CheckoutCode.PAYMENT_PENDING, HttpStatus.CONFLICT, {}, { providerStatus: intent.status });
    }
    if (outcome === 'FAILED') {
      throw new BadRequestException(`Payment not successful (status: ${intent.status})`);
    }

    const payment = await this.prisma.payment.findFirstOrThrow({ where: { orderId, userId } });
    return { success: true, data: this.mapToPaymentResponse(payment), message: 'Payment confirmed successfully' };
  }

  // Valida PI contra intento, orden, tienda, cuenta destino, modo, importe y moneda, y aplica su estado.
  // Es el único camino hacia COMPLETADO con tarjeta: lo usan /confirm, el webhook y el barrido.
  async reconcileIntent(
    intent: Stripe.PaymentIntent,
    expected?: { orderId: string; userId: string },
  ): Promise<'SETTLED' | 'PENDING' | 'FAILED' | 'MISMATCH' | 'COMPENSATION' | 'UNKNOWN'> {
    const { tenantId } = requireTenant();
    let attempt = await this.prisma.paymentAttempt.findUnique({ where: { stripePaymentIntentId: intent.id } });
    // Webhook antes de que la API guardara la respuesta de Stripe: se recupera desde el intento durable
    if (!attempt && intent.metadata?.attemptId) {
      attempt = await this.prisma.paymentAttempt.findUnique({ where: { id: intent.metadata.attemptId } });
    }
    if (!attempt) {
      await this.auditMismatch(intent, 'INTENT_WITHOUT_ATTEMPT', {});
      return 'UNKNOWN';
    }

    const problems: string[] = [];
    // Intentos heredados: sus PI no tienen metadata.tenantId ni destino registrado
    const isLegacy = attempt.idempotencyKey.startsWith('legacy-');
    if (!isLegacy && intent.metadata?.tenantId !== tenantId) problems.push('tenant');
    if (!isLegacy && intent.metadata?.orderId !== attempt.orderId) problems.push('order');
    if (expected && (attempt.orderId !== expected.orderId || attempt.userId !== expected.userId)) problems.push('owner');
    if (intent.amount !== attempt.amountMinor) problems.push('amount');
    if (intent.currency.toLowerCase() !== attempt.currency.toLowerCase()) problems.push('currency');
    if (intent.livemode !== this.gateway.livemode) problems.push('mode');
    const destination = typeof intent.transfer_data?.destination === 'string' ? intent.transfer_data.destination : intent.transfer_data?.destination?.id;
    if (attempt.destinationAccount && destination !== attempt.destinationAccount) problems.push('destination');
    if (problems.length > 0) {
      await this.auditMismatch(intent, 'INTENT_VALIDATION_FAILED', { attemptId: attempt.id, problems });
      return 'MISMATCH';
    }

    if (!attempt.stripePaymentIntentId) await this.linkIntent(attempt.id, intent);

    if (intent.status === 'succeeded') {
      const outcome = await this.settlement.settle({
        orderId: attempt.orderId,
        method: PaymentMethod.STRIPE,
        transactionId: intent.id,
        currency: intent.currency,
        paymentIntentId: intent.id,
        amountMinor: intent.amount,
      });
      return outcome === 'COMPENSATION' ? 'COMPENSATION' : 'SETTLED';
    }

    await this.prisma.paymentAttempt.updateMany({
      where: { id: attempt.id, status: { in: [PaymentAttemptStatus.CREATED, PaymentAttemptStatus.OPEN] } },
      data: { providerStatus: intent.status },
    });
    if (intent.status === 'processing' || intent.status === 'requires_action' || intent.status === 'requires_confirmation') return 'PENDING';
    return 'FAILED';
  }

  private async auditMismatch(intent: Stripe.PaymentIntent, reason: string, details: Record<string, unknown>): Promise<void> {
    await this.settlement.recordIssue(
      this.prisma,
      'PAYMENT_MISMATCH',
      `mismatch:${intent.id}:${reason}`,
      { paymentIntentId: intent.id, reason, metadata: intent.metadata, amount: intent.amount, currency: intent.currency, ...details } as Prisma.InputJsonValue,
      'ERROR',
    );
  }

  // Fuente de verdad de los webhooks de Stripe: valida la firma, guarda el evento y recién entonces lo
  // aplica. Una vez guardado se responde 200 aunque la transición falle: el barrido del inbox la retoma.
  async handleWebhookEvent(rawBody: Buffer, signature: string): Promise<{ received: boolean }> {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      this.logger.error('STRIPE_WEBHOOK_SECRET no configurado: no se puede validar el webhook');
      throw new BadRequestException('Webhook not configured');
    }

    // Stripe firma distinto según el endpoint: el de la cuenta (payment_intent.*) usa
    // STRIPE_WEBHOOK_SECRET y el de Connect (account.updated) STRIPE_CONNECT_WEBHOOK_SECRET.
    // Ambos pueden apuntar a esta misma URL; se acepta la firma de cualquiera de los dos.
    const secrets = [webhookSecret, process.env.STRIPE_CONNECT_WEBHOOK_SECRET].filter(Boolean) as string[];
    let event: Stripe.Event | undefined;
    for (const secret of secrets) {
      try {
        event = this.gateway.verifyWebhook(rawBody, signature, secret);
        break;
      } catch {
        // probar el siguiente secreto
      }
    }
    if (!event) {
      this.logger.error('Firma de webhook inválida para todos los secretos configurados');
      throw new BadRequestException('Invalid Stripe signature');
    }

    const accountId = event.account ?? 'platform';
    await this.control.providerEventInbox.createMany({
      data: [{ provider: 'stripe', accountId, eventId: event.id, type: event.type, payload: event as unknown as object }],
      skipDuplicates: true,
    });
    await failpoint('webhook.afterInbox');

    const row = await this.control.providerEventInbox.findUnique({
      where: { provider_accountId_eventId: { provider: 'stripe', accountId, eventId: event.id } },
      select: { id: true },
    });
    if (row) await this.processInboxRow(row.id);
    return { received: true };
  }

  // Lease recuperable: una sola réplica procesa a la vez, y un crash solo deja un lease que vence.
  // Marcar PROCESSED va DESPUÉS de la transición, que es idempotente: repetirla no tiene efectos.
  async processInboxRow(id: string): Promise<void> {
    const now = new Date();
    const claimed = await this.control.providerEventInbox.updateMany({
      where: {
        id,
        status: { in: [InboxStatus.PENDING, InboxStatus.UNRESOLVED] },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
      },
      data: { leaseUntil: new Date(now.getTime() + INBOX_LEASE_MS), attempts: { increment: 1 } },
    });
    if (claimed.count === 0) return;

    const row = await this.control.providerEventInbox.findUniqueOrThrow({ where: { id } });
    const backoff = new Date(Date.now() + Math.min(60 * 60 * 1000, 30_000 * 2 ** Math.min(row.attempts, 7)));
    try {
      const resolved = await this.dispatchEvent(row.payload as unknown as Stripe.Event);
      await failpoint('webhook.beforeMarkProcessed');
      await this.control.providerEventInbox.update({
        where: { id },
        data: resolved
          ? { status: InboxStatus.PROCESSED, processedAt: new Date(), leaseUntil: null, lastError: null }
          : // Tienda no resoluble: el evento legítimo no se pierde, se reintenta y se alerta
            {
              status: row.attempts >= INBOX_MAX_ATTEMPTS ? InboxStatus.DEAD : InboxStatus.UNRESOLVED,
              leaseUntil: null,
              nextAttemptAt: backoff,
              lastError: 'tenant unresolved',
            },
      });
      if (!resolved) this.logger.error(`Evento ${row.eventId} sin tienda resoluble (intento ${row.attempts})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Falló el evento ${row.eventId} (${row.type}): ${message}`);
      await this.control.providerEventInbox.update({
        where: { id },
        data: {
          status: row.attempts >= INBOX_MAX_ATTEMPTS ? InboxStatus.DEAD : InboxStatus.PENDING,
          leaseUntil: null,
          nextAttemptAt: backoff,
          lastError: message.slice(0, 500),
        },
      });
    }
  }

  async sweepInbox(now = new Date()): Promise<void> {
    const due = await this.control.providerEventInbox.findMany({
      where: { status: { in: [InboxStatus.PENDING, InboxStatus.UNRESOLVED] }, nextAttemptAt: { lte: now } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    for (const { id } of due) await this.processInboxRow(id);
  }

  // true = aplicado (o sin nada que aplicar); false = tienda no resoluble por ahora
  private async dispatchEvent(event: Stripe.Event): Promise<boolean> {
    switch (event.type) {
      case 'payment_intent.succeeded':
      case 'payment_intent.processing':
      case 'payment_intent.requires_action':
        return this.inPaymentIntentTenant(event.data.object as Stripe.PaymentIntent, async (pi) => {
          await this.reconcileIntent(pi);
        });
      case 'payment_intent.payment_failed':
        return this.inPaymentIntentTenant(event.data.object as Stripe.PaymentIntent, (pi) => this.markPaymentFailed(pi));
      case 'payment_intent.canceled':
        return this.inPaymentIntentTenant(event.data.object as Stripe.PaymentIntent, (pi) => this.markIntentCanceled(pi));
      case 'charge.refunded':
        return this.handleChargeRefunded(event.data.object as Stripe.Charge);
      // Onboarding de Connect: solo toca public.tenants, no necesita schema de tienda
      case 'account.updated':
        await this.stripeConnect.syncAccount(event.data.object as Stripe.Account);
        return true;
      // Alta self-service de tiendas (suscripción al SaaS): plano de control, sin schema de tienda.
      // Las sesiones de otros Checkout se ignoran adentro (metadata.kind !== 'tenant_signup').
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        await this.subscriptions.handleCheckoutPaid(event.data.object as Stripe.Checkout.Session);
        return true;
      case 'checkout.session.expired':
        await this.subscriptions.handleCheckoutExpired(event.data.object as Stripe.Checkout.Session);
        return true;
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await this.subscriptions.handleSubscriptionChange(event.data.object as Stripe.Subscription);
        return true;
      default:
        return true;
    }
  }

  // El webhook no pasa por TenantMiddleware (Stripe no manda x-tenant-id): la tienda se saca del
  // PaymentIntent y se abre su contexto para que this.prisma apunte a su schema.
  private async inPaymentIntentTenant(
    pi: Stripe.PaymentIntent,
    fn: (pi: Stripe.PaymentIntent) => Promise<void>,
  ): Promise<boolean> {
    const tenant = await this.stripeConnect.resolveTenantForPaymentIntent(pi);
    if (!tenant) {
      // Los PI previos a la migración multitenant (sin LEGACY_TENANT_ID) y los de una tienda que cambió
      // de cuenta caen acá: quedan en el inbox para reintento y alerta, nunca como pago confirmado.
      this.logger.warn(`Webhook ${pi.id}: no se pudo resolver la tienda`);
      return false;
    }
    await runInTenant(tenant, () => fn(pi));
    return true;
  }

  // Un intento fallido no invalida un pago posterior: nunca degrada COMPLETADO (evento viejo o desordenado)
  private async markPaymentFailed(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    const attempt = await this.prisma.paymentAttempt.findFirst({
      where: { OR: [{ stripePaymentIntentId: paymentIntent.id }, ...(paymentIntent.metadata?.attemptId ? [{ id: paymentIntent.metadata.attemptId }] : [])] },
    });
    if (!attempt) return;

    await withTxRetry(() =>
      this.prisma.$transaction(async (tx) => {
        await lockOrder(tx, attempt.orderId);
        const order = await tx.order.findUniqueOrThrow({ where: { id: attempt.orderId } });
        await tx.paymentAttempt.updateMany({
          where: { id: attempt.id, status: { in: [PaymentAttemptStatus.CREATED, PaymentAttemptStatus.OPEN] } },
          data: { providerStatus: paymentIntent.status },
        });
        if (order.paymentStatus !== PaymentStatus.PENDIENTE || order.status !== OrderStatus.PENDIENTE) return;
        await tx.payment.updateMany({ where: { orderId: order.id, status: PaymentStatus.PENDIENTE }, data: { status: PaymentStatus.FALLIDO } });
        await tx.order.update({ where: { id: order.id }, data: { paymentStatus: PaymentStatus.FALLIDO } });
      }),
    );
  }

  private async markIntentCanceled(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    await this.prisma.paymentAttempt.updateMany({
      where: { stripePaymentIntentId: paymentIntent.id, status: { in: [PaymentAttemptStatus.CREATED, PaymentAttemptStatus.OPEN] } },
      data: { status: PaymentAttemptStatus.CANCELED, providerStatus: 'canceled' },
    });
  }

  private async handleChargeRefunded(charge: Stripe.Charge): Promise<boolean> {
    const tenantId = charge.metadata?.tenantId;
    const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
    if (!tenantId || !paymentIntentId) return true;
    const tenant = await this.control.tenant.findUnique({ where: { id: tenantId }, select: { id: true, schemaName: true } });
    if (!tenant) return false;
    await runInTenant({ tenantId: tenant.id, schemaName: tenant.schemaName }, () => this.markCompensationRefunded(paymentIntentId));
    return true;
  }

  // Reembolso solicitado ≠ completado: REEMBOLSADO solo con la confirmación del proveedor
  private async markCompensationRefunded(paymentIntentId: string, refundId?: string): Promise<void> {
    const compensation = await this.prisma.paymentCompensation.findUnique({ where: { paymentIntentId } });
    if (!compensation || compensation.status === CompensationStatus.REFUNDED) return;
    await withTxRetry(() =>
      this.prisma.$transaction(async (tx) => {
        await lockOrder(tx, compensation.orderId);
        await tx.paymentCompensation.update({
          where: { id: compensation.id },
          data: { status: CompensationStatus.REFUNDED, ...(refundId ? { refundId } : {}), lastError: null },
        });
        if (compensation.reason === 'LATE_PAYMENT') {
          await tx.order.update({ where: { id: compensation.orderId }, data: { paymentStatus: PaymentStatus.REEMBOLSADO } });
          await tx.payment.updateMany({ where: { orderId: compensation.orderId }, data: { status: PaymentStatus.REEMBOLSADO, transactionId: paymentIntentId } });
        }
      }),
    );
  }

  // Compensaciones pendientes: reembolso idempotente (clave estable por compensación), reintentable.
  async processCompensations(): Promise<void> {
    const pending = await this.prisma.paymentCompensation.findMany({ where: { status: CompensationStatus.REQUESTED }, take: 50 });
    for (const compensation of pending) {
      try {
        const refund = await this.gateway.refundDestinationCharge(compensation.paymentIntentId, `sf-refund-${compensation.id}`);
        if (refund.status === 'succeeded') {
          await this.markCompensationRefunded(compensation.paymentIntentId, refund.id);
        } else {
          await this.prisma.paymentCompensation.update({
            where: { id: compensation.id },
            data: { status: refund.status === 'failed' ? CompensationStatus.MANUAL_REVIEW : CompensationStatus.REFUND_PENDING, refundId: refund.id, attempts: { increment: 1 } },
          });
        }
      } catch (error) {
        const attempts = compensation.attempts + 1;
        await this.prisma.paymentCompensation.update({
          where: { id: compensation.id },
          data: {
            attempts,
            lastError: (error instanceof Error ? error.message : String(error)).slice(0, 500),
            ...(attempts >= 5 && !isProviderUnavailable(error) ? { status: CompensationStatus.MANUAL_REVIEW } : {}),
          },
        });
      }
    }
  }

  // Intento persistido sin PaymentIntent (la API cayó tras llamar a Stripe): se concilia sin crear un cobro
  // nuevo a ciegas. Dentro del horizonte, la misma clave devuelve el mismo PI; después se busca por metadata.
  async recoverStaleAttempts(olderThanMs = 5 * 60 * 1000): Promise<void> {
    const stale = await this.prisma.paymentAttempt.findMany({
      where: { status: PaymentAttemptStatus.CREATED, stripePaymentIntentId: null, updatedAt: { lt: new Date(Date.now() - olderThanMs) } },
      take: 50,
    });
    for (const attempt of stale) {
      try {
        const intent = await this.obtainIntent(attempt);
        if (intent !== 'RETRY') await this.reconcileIntent(intent);
      } catch (error) {
        this.logger.warn(`No se pudo conciliar el intento ${attempt.id}: ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  // Antes de vencer o cancelar una orden con cobro iniciado: ¿qué sabe el proveedor?
  // 'FREE' = no hay cobro vivo, se puede liberar. 'PAID' = se liquidó. 'HOLD' = incierto, no liberar.
  async resolveProviderBeforeRelease(orderId: string): Promise<'FREE' | 'PAID' | 'HOLD'> {
    const attempt = await this.prisma.paymentAttempt.findFirst({
      where: { orderId, status: { in: [PaymentAttemptStatus.CREATED, PaymentAttemptStatus.OPEN] } },
    });
    if (!attempt) return 'FREE';
    try {
      if (!attempt.stripePaymentIntentId) {
        const found = await this.gateway.findByAttempt(attempt.id);
        if (!found) {
          // Marcarlo cierra la puerta: si un create en vuelo responde tarde, linkIntent no lo reabre, y su
          // eventual cobro entra como pago tardío a compensación
          await this.prisma.paymentAttempt.updateMany({
            where: { id: attempt.id, status: PaymentAttemptStatus.CREATED },
            data: { status: PaymentAttemptStatus.ABANDONED },
          });
          return 'FREE';
        }
        await this.linkIntent(attempt.id, found);
        attempt.stripePaymentIntentId = found.id;
      }
      const intent = await this.gateway.retrieve(attempt.stripePaymentIntentId);
      if (intent.status === 'succeeded') {
        await this.reconcileIntent(intent);
        return 'PAID';
      }
      if (intent.status === 'processing') return 'HOLD';
      if (intent.status === 'canceled') return 'FREE';
      // Sin dinero en juego todavía: se cancela FUERA de cualquier transacción, y si Stripe lo niega
      // porque acaba de completarse, se vuelve a mirar
      try {
        await this.gateway.cancel(intent.id, `sf-cancel-${attempt.id}`);
      } catch (error) {
        if (isProviderUnavailable(error)) return 'HOLD';
        const fresh = await this.gateway.retrieve(intent.id);
        if (fresh.status === 'succeeded') {
          await this.reconcileIntent(fresh);
          return 'PAID';
        }
        return fresh.status === 'canceled' ? 'FREE' : 'HOLD';
      }
      return 'FREE';
    } catch (error) {
      this.logger.warn(`Proveedor no disponible para la orden ${orderId}: ${error instanceof Error ? error.message : error}`);
      return 'HOLD';
    }
  }

  // Genera la factura en PDF de la orden y la envía al cliente. La invoca el consumidor del outbox: si
  // lanza, el evento se reintenta. El pago ya está confirmado y no depende de esto.
  async sendInvoiceEmail(orderId: string): Promise<void> {
    const { buffer, filename, data } = await this.invoiceService.generateOrderInvoice(orderId);
    if (!data.customer.email) return;

    await this.mailService.sendInvoice({
      to: data.customer.email,
      firstName: data.customer.name,
      orderNumber: data.number,
      total: data.total,
      pdf: buffer,
      filename,
    });
  }

  async sendPaidPush(userId: string, orderId: string, orderNumber: string): Promise<void> {
    await this.notificationsService.sendPushNotification(userId, {
      title: 'Stella Femme',
      body: `Tu pago del pedido ${orderNumber} fue confirmado.`,
      url: `/account/orders/${orderId}`,
    });
  }

  async sendCancelledPush(userId: string, orderId: string, orderNumber: string): Promise<void> {
    await this.notificationsService.sendPushNotification(userId, {
      title: `Pedido ${orderNumber}`,
      body: 'Tu pedido fue cancelado.',
      url: `/account/orders/${orderId}`,
    });
  }

  async findAll(userId: string): Promise<{
    success: boolean;
    data: PaymentResponseDto[];
    message: string;
  }> {
    const payments = await this.prisma.payment.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return {
      success: true,
      data: payments.map((payment) => this.mapToPaymentResponse(payment)),
      message: 'Payments retrieved successfully',
    };
  }

  async findOne(
    id: string,
    userId: string,
  ): Promise<{
    success: boolean;
    data: PaymentResponseDto;
    message: string;
  }> {

    const payment = await this.prisma.payment.findFirst({
  where: { id, userId },
    });

    if (!payment) {
    throw new NotFoundException(`Payment with ID ${id} not found`);
    }
    
    return {
    success: true,
    data: this.mapToPaymentResponse(payment),
    message: 'Payment retrieved successfully',
    };
  }


  async findByOrder(
    orderId: string,
    userId: string,
  ): Promise<{
    success: boolean;
    data: PaymentResponseDto | null;
    message: string;
  }> {
    const payment = await this.prisma.payment.findFirst({
  where: { orderId, userId },
});

    return {
  success: true,
  data: payment ? this.mapToPaymentResponse(payment) : null,
  message: 'Payment retrieved successfully',
    };
  }

  private assertSimulationAllowed(): void {
    if (!simulatedPaymentsEnabled()) {
      throw new CheckoutException(CheckoutCode.PAYMENT_SIMULATION_DISABLED, HttpStatus.FORBIDDEN);
    }
  }
  async generateQrPayment(orderId: string, origin?: string): Promise<{
    orderId: string;
    orderNumber: string;
    amount: number;
    qrDataUrl: string;
    confirmUrl: string;
    status: PaymentStatus;
  }> {
    assertPlanFeature('qrPayments');
    this.assertSimulationAllowed();
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) {
      throw new NotFoundException(`Order with ID ${orderId} not found`);
    }

    const amount = Number(order.totalAmount);
    const transactionId = `QR-${order.orderNumber}-${Date.now()}`;

    await this.prisma.payment.upsert({
      where: { orderId },
      create: {
        orderId,
        userId: order.userId,
        amount: order.totalAmount,
        currency: 'BOB',
        status: order.paymentStatus === PaymentStatus.COMPLETADO ? PaymentStatus.COMPLETADO : PaymentStatus.PENDIENTE,
        paymentMethod: 'QR',
        transactionId,
      },
      update: {
        paymentMethod: 'QR',
        amount: order.totalAmount,
        transactionId,
      },
    });

    await this.prisma.order.update({
      where: { id: orderId },
      data: { paymentMethod: PaymentMethod.QR },
    });

    // La URL codificada en el QR dirige a la confirmación de pago
    const publicUrl = origin || process.env.FRONTEND_URL || 'https://stella-front.wonderfulriver-db5286cd.eastus.azurecontainerapps.io';
    // El QR lo escanea OTRO dispositivo (el celular del cliente), que no tiene la tienda guardada:
    // sin ?tenant= la página de confirmación recibiría 401 TENANT_REQUIRED de la API.
    const confirmUrl = withTenantParam(`${publicUrl}/checkout/qr-confirm?orderId=${orderId}`);

    const qrDataUrl = await QRCode.toDataURL(confirmUrl, {
      margin: 2,
      width: 320,
      color: {
        dark: '#111827',
        light: '#FFFFFF',
      },
    });

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      amount,
      qrDataUrl,
      confirmUrl,
      status: order.paymentStatus,
    };
  }

  // QR simulado (demo). Mismo cierre que Stripe, pero bloqueado fuera de un entorno de pruebas explícito.
  async markQrPaymentSucceeded(orderId: string, customTxId?: string): Promise<any> {
    this.assertSimulationAllowed();
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException(`Order with ID ${orderId} not found`);
    }
    if (order.status === OrderStatus.CANCELADO) throw new CheckoutException(CheckoutCode.ORDER_NOT_PAYABLE);
    await this.settlement.settle({
      orderId,
      method: PaymentMethod.QR,
      transactionId: customTxId && !customTxId.startsWith('pi_') ? customTxId : `QR-${order.orderNumber}`,
      currency: 'BOB',
    });
    return this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  }

  async getQrPaymentStatus(orderId: string): Promise<{
    success: boolean;
    status: PaymentStatus;
    isPaid: boolean;
    orderId: string;
    orderNumber: string;
    totalAmount: number;
  }> {
    this.assertSimulationAllowed();
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) {
      throw new NotFoundException(`Order with ID ${orderId} not found`);
    }

    return {
      success: true,
      status: order.paymentStatus,
      isPaid: order.paymentStatus === PaymentStatus.COMPLETADO,
      orderId: order.id,
      orderNumber: order.orderNumber,
      totalAmount: Number(order.totalAmount),
    };
  }

  private mapToPaymentResponse(payment: {
  id: string;
  orderId: string;
  userId: string;
  amount: Prisma.Decimal;
  currency: string;
  status: PaymentStatus;
  paymentMethod: string | null;
  transactionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): PaymentResponseDto {
    return {
  id: payment.id,
  orderId: payment.orderId,
  userId: payment.userId,
  currency: payment.currency,
  amount: payment.amount.toNumber(),
  status: payment.status,
  paymentMethod: payment.paymentMethod,
  transactionId: payment.transactionId,
  createAt: payment.createdAt,
  updateAt: payment.updatedAt,
};

}



}
