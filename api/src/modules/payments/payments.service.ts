import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderStatus, PaymentMethod, PaymentStatus, Prisma } from '@prisma/client';
import * as QRCode from 'qrcode';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { CreatePaymentIntentResponse, PaymentResponseDto, PaymentApiResponseDto } from './dto/payment-response.dto';
import { ConfirmPaymentDto } from './dto/confirm-payment.dto';
import { InvoiceService } from '../invoices/invoice.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InventoryService } from '../branches/inventory.service';
import { StripeConnectService } from './stripe-connect.service';
import { SubscriptionsService } from '../platform/subscriptions.service';
import { requireTenant, runInTenant, withTenantParam } from '../../tenancy/tenant-context';

@Injectable()
export class PaymentsService {
    private stripe: Stripe;
    private readonly logger = new Logger(PaymentsService.name);

    constructor(
        private prisma: PrismaService,
        private invoiceService: InvoiceService,
        private mailService: MailService,
        private notificationsService: NotificationsService,
        private inventoryService: InventoryService,
        private stripeConnect: StripeConnectService,
        private subscriptions: SubscriptionsService,
    ) {
        this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    }

    // Los ítems del carrito reservan (descuentan) stock real al agregarse (CartService.addItem).
    // Si se borran sin pasar por acá (ej. al cerrar el carrito tras un pago), ese stock queda
    // descontado para siempre porque nadie lo devuelve. Esto pasa con cualquier ítem agregado al
    // carrito después de crear la orden pero antes de que el pago se confirme.
    private async releaseCartStock(tx: Prisma.TransactionClient, cartId: string): Promise<void> {
        const items = await tx.cartItem.findMany({ where: { cartId } });
        for (const item of items) {
            if (item.quantity <= 0) continue;
            if (item.branchId) {
                await this.inventoryService.increment(tx, item.productId, item.branchId, item.size ?? '', item.quantity);
            } else {
                await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
            }
        }
        await tx.cartItem.deleteMany({ where: { cartId } });
    }

    async createPaymentIntent(
    userId: string,
    createPaymentIntentDto: CreatePaymentIntentDto,
  ): Promise<{
    success: boolean;
    data: CreatePaymentIntentResponse;
    message: string;
  }> {
    const { orderId, currency = 'usd' } = createPaymentIntentDto;

    const order = await this.prisma.order.findFirst({
    where: { id: orderId, userId },
    });
    if (!order) {
    throw new NotFoundException(`Order with ID ${orderId} not found`);
    }

    if (order.paymentStatus === PaymentStatus.COMPLETADO) {
      throw new BadRequestException('payment already completed for this order');
    }

    // El monto SIEMPRE se calcula desde la orden ya guardada en la BD: nunca se confía en un monto enviado por el cliente
    const amount = order.totalAmount.toNumber();
    const amountInCents = Math.round(amount * 100);

    // Stripe Connect (destination charge): los fondos van a la cuenta conectada de la tienda y la
    // plataforma retiene solo su comisión. metadata.tenantId es lo que usa el webhook para saber
    // en qué schema está la orden.
    const { tenantId } = requireTenant();
    const payout = await this.stripeConnect.getPayoutAccount(tenantId);

    const paymentIntent = await this.stripe.paymentIntents.create({
      amount: amountInCents,
      currency,
      metadata: { orderId, userId, tenantId },
      automatic_payment_methods: {
        enabled: true,
      },
      // La tienda figura como comerciante (extracto bancario del cliente, disputas, liquidación)
      on_behalf_of: payout.accountId,
      transfer_data: { destination: payout.accountId },
      application_fee_amount: this.stripeConnect.feeFor(amountInCents, payout.feeBps),
    });

    // upsert: reintentar el pago de la misma orden (ej. tarjeta rechazada) reutiliza el registro en vez de chocar
    // con la restricción única de Payment.orderId
    const [payment] = await this.prisma.$transaction([
      this.prisma.payment.upsert({
        where: { orderId },
        create: {
          orderId,
          userId,
          amount,
          currency,
          status: PaymentStatus.PENDIENTE,
          paymentMethod: 'STRIPE',
          transactionId: paymentIntent.id,
        },
        update: {
          amount,
          currency,
          status: PaymentStatus.PENDIENTE,
          paymentMethod: 'STRIPE',
          transactionId: paymentIntent.id,
        },
      }),
      this.prisma.order.update({
        where: { id: orderId },
        data: { stripePaymentIntentId: paymentIntent.id },
      }),
    ]);

       return {
     success: true,
     data: {
    clientSecret: paymentIntent.client_secret!,
    paymentId: payment.id,
     },
     message: 'Payment intent created successfully',
    };

  }

  // Endpoint usado por el frontend justo después de stripe.confirmPayment, para feedback inmediato.
  // Es idempotente: el webhook puede llegar antes o después y no debe pisarle el resultado a este flujo.
  async confirmPayment(
    userId: string | undefined,
    confirmPaymentDto: ConfirmPaymentDto,
  ): Promise<{ success: boolean; data: PaymentResponseDto; message: string }> {
    const { paymentIntentId, orderId } = confirmPaymentDto;

    // Soporte para pagos QR en confirmPayment
    if (paymentIntentId.startsWith('QR_') || paymentIntentId.startsWith('QR-')) {
      await this.markQrPaymentSucceeded(orderId, paymentIntentId);
      const updatedPayment = await this.prisma.payment.findFirst({
        where: { orderId },
      });
      if (updatedPayment) {
        return {
          success: true,
          data: this.mapToPaymentResponse(updatedPayment),
          message: 'Payment confirmed successfully',
        };
      }
    }

    let payment = await this.prisma.payment.findFirst({
      where: {
        orderId,
        ...(userId ? { userId } : {}),
      },
    });
    if (!payment) {
      payment = await this.prisma.payment.findFirst({
        where: { orderId },
      });
    }
    if (!payment) {
      throw new NotFoundException('payment not found');
    }

    if (payment.status !== PaymentStatus.COMPLETADO) {
      let paymentIntent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
      // Todos los PI viven en la misma cuenta de plataforma: sin este chequeo, un PI pagado en otra
      // tienda podría usarse para confirmar una orden de esta.
      const currentTenantId = requireTenant().tenantId;
      // Excepción transicional: PI de antes del multitenant (sin tenantId ni destino) en la tienda original
      const isLegacyIntent =
        !paymentIntent.metadata?.tenantId &&
        !paymentIntent.transfer_data &&
        currentTenantId === process.env.LEGACY_TENANT_ID;
      if (paymentIntent.metadata?.tenantId !== currentTenantId && !isLegacyIntent) {
        throw new NotFoundException('payment not found');
      }
      if (
        paymentIntent.status === 'requires_payment_method' &&
        process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')
      ) {
        const publicUrl = process.env.FRONTEND_URL || 'https://stella-front.wonderfulriver-db5286cd.eastus.azurecontainerapps.io';
        paymentIntent = await this.stripe.paymentIntents.confirm(paymentIntentId, {
          payment_method: 'pm_card_visa',
          return_url: withTenantParam(`${publicUrl}/checkout/success?orderId=${orderId}`),
        });
      }
      if (paymentIntent.status !== 'succeeded' && paymentIntent.status !== 'processing') {
        throw new BadRequestException(`Payment not successful (status: ${paymentIntent.status})`);
      }
      await this.markPaymentSucceeded(paymentIntent);
    }

    const updatedPayment = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });

    return {
      success: true,
      data: this.mapToPaymentResponse(updatedPayment),
      message: 'Payment confirmed successfully',
    };
  }

  // Fuente de verdad de los webhooks de Stripe: valida la firma y procesa el evento
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
        event = this.stripe.webhooks.constructEvent(rawBody, signature, secret);
        break;
      } catch {
        // probar el siguiente secreto
      }
    }
    if (!event) {
      this.logger.error('Firma de webhook inválida para todos los secretos configurados');
      throw new BadRequestException('Invalid Stripe signature');
    }

    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.inPaymentIntentTenant(event.data.object as Stripe.PaymentIntent, (pi) => this.markPaymentSucceeded(pi));
        break;
      case 'payment_intent.payment_failed':
        await this.inPaymentIntentTenant(event.data.object as Stripe.PaymentIntent, (pi) => this.markPaymentFailed(pi));
        break;
      // Onboarding de Connect: solo toca public.tenants, no necesita schema de tienda
      case 'account.updated':
        await this.stripeConnect.syncAccount(event.data.object as Stripe.Account);
        break;
      // Alta self-service de tiendas (suscripción al SaaS): plano de control, sin schema de tienda.
      // Las sesiones de otros Checkout se ignoran adentro (metadata.kind !== 'tenant_signup').
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        await this.subscriptions.handleCheckoutPaid(event.data.object as Stripe.Checkout.Session);
        break;
      case 'checkout.session.expired':
        await this.subscriptions.handleCheckoutExpired(event.data.object as Stripe.Checkout.Session);
        break;
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await this.subscriptions.handleSubscriptionChange(event.data.object as Stripe.Subscription);
        break;
      default:
        break;
    }

    return { received: true };
  }

  // El webhook no pasa por TenantMiddleware (Stripe no manda x-tenant-id): la tienda se saca del
  // PaymentIntent y se abre su contexto para que this.prisma apunte a su schema.
  private async inPaymentIntentTenant(
    pi: Stripe.PaymentIntent,
    fn: (pi: Stripe.PaymentIntent) => Promise<void>,
  ): Promise<void> {
    const tenant = await this.stripeConnect.resolveTenantForPaymentIntent(pi);
    if (!tenant) {
      // Se responde 200 igual: con error Stripe reintentaría el evento por días sin que cambie nada.
      // Los PI previos a la migración multitenant caen acá (no tienen metadata.tenantId).
      this.logger.warn(`Webhook ${pi.id} ignorado: no se pudo resolver la tienda`);
      return;
    }
    await runInTenant(tenant, () => fn(pi));
  }

  // Idempotente: llamado tanto por /confirm como por el webhook, cualquiera que llegue primero
  private async markPaymentSucceeded(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    const orderId = paymentIntent.metadata?.orderId;
    let payment = orderId
      ? await this.prisma.payment.findFirst({ where: { orderId } })
      : await this.prisma.payment.findFirst({ where: { transactionId: paymentIntent.id } });

    if (!payment && orderId) {
      const ord = await this.prisma.order.findUnique({ where: { id: orderId } });
      if (ord) {
        payment = await this.prisma.payment.create({
          data: {
            orderId: ord.id,
            userId: ord.userId,
            amount: ord.totalAmount,
            currency: paymentIntent.currency.toUpperCase(),
            status: PaymentStatus.COMPLETADO,
            paymentMethod: 'STRIPE',
            transactionId: paymentIntent.id,
          },
        });
      }
    }

    if (!payment || payment.status === PaymentStatus.COMPLETADO) return;
    const targetOrderId = orderId || payment.orderId;

    const [, order] = await this.prisma.$transaction([
      this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.COMPLETADO,
          paymentMethod: 'STRIPE',
          transactionId: paymentIntent.id,
        },
      }),
      this.prisma.order.update({
        where: { id: targetOrderId },
        data: {
          paymentStatus: PaymentStatus.COMPLETADO,
          status: OrderStatus.PROCESANDO,
          paymentMethod: PaymentMethod.STRIPE,
          stripePaymentIntentId: paymentIntent.id,
        },
      }),
    ]);

    if (order.cartId) {
      await this.prisma.$transaction(async (tx) => {
        // Los ítems comprados son una venta finalizada: se eliminan del carrito y se marca checkout=true.
        // NUNCA devolver el stock a la tienda (releaseCartStock) porque el cliente ya pagó por ellos.
        await tx.cartItem.deleteMany({ where: { cartId: order.cartId! } });
        await tx.cart.update({ where: { id: order.cartId! }, data: { checkout: true } });
      });
    }

    // Vaciar y marcar como completado cualquier carrito activo pendiente del usuario
    const activeCarts = await this.prisma.cart.findMany({
      where: { userId: order.userId, checkout: false },
    });
    for (const c of activeCarts) {
      if (c.id === order.cartId) continue;
      await this.prisma.$transaction(async (tx) => {
        await tx.cartItem.deleteMany({ where: { cartId: c.id } });
        await tx.cart.update({ where: { id: c.id }, data: { checkout: true } });
      });
    }

    // Factura por correo y notificación push: sin await, para no demorar la respuesta del pago
    void this.sendInvoiceEmail(orderId);
    void this.notificationsService
      .sendPushNotification(order.userId, {
        title: 'Stella Femme',
        body: `Tu pago del pedido ${order.orderNumber} fue confirmado.`,
        url: `/account/orders/${order.id}`,
      })
      .catch(() => undefined);
  }

  private async markPaymentFailed(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    const orderId = paymentIntent.metadata?.orderId;
    if (!orderId) return;

    const payment = await this.prisma.payment.findFirst({
      where: { orderId, transactionId: paymentIntent.id },
    });
    if (!payment || payment.status === PaymentStatus.COMPLETADO) return;

    await this.prisma.$transaction([
      this.prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.FALLIDO } }),
      this.prisma.order.update({ where: { id: orderId }, data: { paymentStatus: PaymentStatus.FALLIDO } }),
    ]);
  }

  // Genera la factura en PDF de la orden y la envía al cliente. Nunca lanza: el pago ya está confirmado
  private async sendInvoiceEmail(orderId: string): Promise<void> {
    try {
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
    } catch (error) {
      this.logger.error(`No se pudo enviar la factura de la orden ${orderId}: ${error instanceof Error ? error.message : error}`);
    }
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

  async generateQrPayment(orderId: string, origin?: string): Promise<{
    orderId: string;
    orderNumber: string;
    amount: number;
    qrDataUrl: string;
    confirmUrl: string;
    status: PaymentStatus;
  }> {
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

  // QR simulado (method QR) o pago manual aprobado por la tienda (BANK_QR / USDT): mismo cierre que Stripe
  async markQrPaymentSucceeded(orderId: string, customTxId?: string, method: PaymentMethod = PaymentMethod.QR): Promise<any> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { payment: true },
    });
    if (!order) {
      throw new NotFoundException(`Order with ID ${orderId} not found`);
    }

    if (order.paymentStatus === PaymentStatus.COMPLETADO) {
      return order;
    }

    const transactionId = (customTxId && !customTxId.startsWith('pi_'))
      ? customTxId
      : (order.payment?.transactionId && order.payment.transactionId.startsWith('QR-')
          ? order.payment.transactionId
          : `QR-${order.orderNumber}-${Date.now()}`);

    const [, updatedOrder] = await this.prisma.$transaction([
      this.prisma.payment.upsert({
        where: { orderId },
        create: {
          orderId,
          userId: order.userId,
          amount: order.totalAmount,
          currency: method === PaymentMethod.USDT ? 'USDT' : 'BOB',
          status: PaymentStatus.COMPLETADO,
          paymentMethod: method,
          transactionId,
        },
        update: {
          status: PaymentStatus.COMPLETADO,
          paymentMethod: method,
          transactionId,
        },
      }),
      this.prisma.order.update({
        where: { id: orderId },
        data: {
          paymentStatus: PaymentStatus.COMPLETADO,
          status: OrderStatus.PROCESANDO,
          paymentMethod: method,
        },
      }),
    ]);

    if (updatedOrder.cartId) {
      await this.prisma.$transaction(async (tx) => {
        // Los ítems comprados son una venta finalizada: se eliminan del carrito y se marca checkout=true.
        // NUNCA devolver el stock a la tienda (releaseCartStock) porque el cliente ya pagó por ellos.
        await tx.cartItem.deleteMany({ where: { cartId: updatedOrder.cartId! } });
        await tx.cart.update({ where: { id: updatedOrder.cartId! }, data: { checkout: true } });
      });
    }

    const activeCarts = await this.prisma.cart.findMany({
      where: { userId: updatedOrder.userId, checkout: false },
    });
    for (const c of activeCarts) {
      if (c.id === updatedOrder.cartId) continue;
      await this.prisma.$transaction(async (tx) => {
        await tx.cartItem.deleteMany({ where: { cartId: c.id } });
        await tx.cart.update({ where: { id: c.id }, data: { checkout: true } });
      });
    }

    void this.sendInvoiceEmail(orderId);
    void this.notificationsService
      .sendPushNotification(updatedOrder.userId, {
        title: 'Stella Femme - Pago QR Confirmado',
        body: `Tu pago por QR del pedido ${updatedOrder.orderNumber} fue confirmado exitosamente.`,
        url: `/account/orders/${updatedOrder.id}`,
      })
      .catch(() => undefined);

    return updatedOrder;
  }

  async getQrPaymentStatus(orderId: string): Promise<{
    success: boolean;
    status: PaymentStatus;
    isPaid: boolean;
    orderId: string;
    orderNumber: string;
    totalAmount: number;
  }> {
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
