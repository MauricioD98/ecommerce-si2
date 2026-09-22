import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentStatus, Prisma } from '@prisma/client';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { CreatePaymentIntentResponse, PaymentResponseDto, PaymentApiResponseDto } from './dto/payment-response.dto';
import { ConfirmPaymentDto } from './dto/confirm-payment.dto';

@Injectable()
export class PaymentsService {
    private stripe: Stripe;

    constructor(private prisma: PrismaService) {
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
    const { orderId, amount, currency = 'usd' } = createPaymentIntentDto;

    const order = await this.prisma.order.findFirst({
    where: { id: orderId, userId },
    });
    if (!order) {
    throw new NotFoundException(`Order with ID ${orderId} not found`);
    }

    const existingPayment = await this.prisma.payment.findFirst({
    where: { orderId },
        });

    if (existingPayment && existingPayment.status === PaymentStatus.COMPLETADO) {
  throw new BadRequestException('payment already complted for this order');
}

    const paymentIntent = await this.stripe.paymentIntents.create({
    amount: Math.round(amount * 100),
    currency,
    metadata: { orderId, userId },
    });

    const payment = await this.prisma.payment.create({
  data: {
    orderId,
    userId,
    amount,
    currency,
    status: PaymentStatus.PENDIENTE,
    paymentMethod: 'STRIPE',
    transactionId: paymentIntent.id,
    },
  });
       return {
     success: true,
     data: {
    clientSecret: paymentIntent.client_secret!,
    paymentId: payment.id,
     },
     message: 'Payment intent created successfully',
    }; 

  }

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

    if (payment.status === PaymentStatus.COMPLETADO) {
    throw new BadRequestException('Payment already completed ');
    }  
    
    const paymentIntent =
  await this.stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== 'succeeded') {
    throw new BadRequestException('Payment not successful');
    }

    const [updatedPayment] = await this.prisma.$transaction([
  this.prisma.payment.update({
    where: { id: payment.id },
    data: { status: PaymentStatus.COMPLETADO },
  }),

  this.prisma.order.update({
    where: { id: orderId },
    data: { status: 'PROCESANDO' },
    }),
   ]);

    const order = await this.prisma.order.findFirst({
     where: {
     id: orderId,
    },
    });

    if (order?.cartId) {
    await this.prisma.cart.update({
    where: { id: order.cartId },
    data: { checkout: true },
     });
    }
    return {
        success: true,
        data: this.mapToPaymentResponse(updatedPayment),
        message: 'Payment confirmed successfully',
        };

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
