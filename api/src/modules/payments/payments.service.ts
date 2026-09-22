import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { CreatePaymentIntentResponse, PaymentResponseDto, PaymentApiResponseDto } from './dto/payment-response.dto';
import { ConfirmPaymentDto } from './dto/confirm-payment.dto';
import { InvoiceService } from '../invoices/invoice.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class PaymentsService {
    private stripe: Stripe;
    private readonly logger = new Logger(PaymentsService.name);

    constructor(
        private prisma: PrismaService,
        private invoiceService: InvoiceService,
        private mailService: MailService,
        private notificationsService: NotificationsService,
    ) {
        this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
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

    const paymentIntent = await this.stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency,
      metadata: { orderId, userId },
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never',
      },
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
    userId: string,
    confirmPaymentDto: ConfirmPaymentDto,
  ): Promise<{ success: boolean; data: PaymentResponseDto; message: string }> {
    const { paymentIntentId, orderId } = confirmPaymentDto;

    const payment = await this.prisma.payment.findFirst({
  where: {
    orderId,
    userId,
    transactionId: paymentIntentId,
        },
    });
    if (!payment) {
  throw new NotFoundException('payment not found');
    }

    if (payment.status !== PaymentStatus.COMPLETADO) {
      let paymentIntent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
      if (
        paymentIntent.status === 'requires_payment_method' &&
        process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')
      ) {
        paymentIntent = await this.stripe.paymentIntents.confirm(paymentIntentId, {
          payment_method: 'pm_card_visa',
          return_url: 'http://localhost:3001/api/v1/payments/return',
        });
      }
      if (paymentIntent.status !== 'succeeded') {
        throw new BadRequestException('Payment not successful');
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

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (error) {
      this.logger.error(`Firma de webhook inválida: ${(error as Error).message}`);
      throw new BadRequestException('Invalid Stripe signature');
    }

    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.markPaymentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;
      case 'payment_intent.payment_failed':
        await this.markPaymentFailed(event.data.object as Stripe.PaymentIntent);
        break;
      default:
        break;
    }

    return { received: true };
  }

  // Idempotente: llamado tanto por /confirm como por el webhook, cualquiera que llegue primero
  private async markPaymentSucceeded(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    const orderId = paymentIntent.metadata?.orderId;
    if (!orderId) {
      this.logger.warn(`PaymentIntent ${paymentIntent.id} sin metadata.orderId`);
      return;
    }

    const payment = await this.prisma.payment.findFirst({
      where: { orderId, transactionId: paymentIntent.id },
    });
    if (!payment || payment.status === PaymentStatus.COMPLETADO) return;

    const [, order] = await this.prisma.$transaction([
      this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.COMPLETADO },
      }),
      this.prisma.order.update({
        where: { id: orderId },
        data: {
          paymentStatus: PaymentStatus.COMPLETADO,
          status: OrderStatus.PROCESANDO,
          stripePaymentIntentId: paymentIntent.id,
        },
      }),
    ]);

    if (order.cartId) {
      await this.prisma.cartItem.deleteMany({
        where: { cartId: order.cartId },
      });
      await this.prisma.cart.update({
        where: { id: order.cartId },
        data: { checkout: true },
      });
    }

    // Vaciar y marcar como completado cualquier carrito activo pendiente del usuario
    const activeCarts = await this.prisma.cart.findMany({
      where: { userId: order.userId, checkout: false },
    });
    for (const c of activeCarts) {
      await this.prisma.cartItem.deleteMany({ where: { cartId: c.id } });
      await this.prisma.cart.update({ where: { id: c.id }, data: { checkout: true } });
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
