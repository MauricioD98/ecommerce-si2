import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, PaymentMethod, PaymentProofStatus, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { i18nMessage } from '../../i18n/i18n-message';
import type { AuthUser } from '../../common/decorators/interfaces/request-with-user.interface';
import { OrdersService } from '../orders/orders.service';
import { PaymentsService } from './payments.service';
import { UploadedImage, detectImageType, isValidTxId } from './payment-settings.service';

const MANUAL_METHODS: PaymentMethod[] = [PaymentMethod.BANK_QR, PaymentMethod.USDT];

/**
 * Pagos manuales (QR bancario y USDT): el cliente informa el pago y la tienda lo verifica desde
 * Pedidos. Hasta que se aprueba, el pedido queda PENDIENTE con su stock reservado; si se rechaza,
 * se cancela y el stock vuelve (OrdersService.cancel).
 */
@Injectable()
export class PaymentProofsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
  ) {}

  /** El cliente sube el comprobante (QR) o el TxID (USDT). Se puede reemplazar mientras no se revisó. */
  async submit(orderId: string, userId: string, method: PaymentMethod, txIdRaw: string | undefined, file?: UploadedImage) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      select: { id: true, status: true, paymentStatus: true, paymentProof: { select: { status: true } } },
    });
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    if (
      !MANUAL_METHODS.includes(method) ||
      order.status !== OrderStatus.PENDIENTE ||
      order.paymentStatus !== PaymentStatus.PENDIENTE ||
      (order.paymentProof && order.paymentProof.status !== PaymentProofStatus.PENDIENTE)
    ) {
      throw new BadRequestException(i18nMessage('errors.ORDER_NOT_AWAITING_PROOF'));
    }

    const txId = txIdRaw?.trim() || null;
    let image: { image: Uint8Array<ArrayBuffer>; imageType: string } | null = null;
    if (file?.buffer?.length) image = { image: new Uint8Array(file.buffer), imageType: detectImageType(file) };

    const settings = await this.prisma.paymentSettings.findUnique({
      where: { id: 'default' },
      select: { qrEnabled: true, qrImageType: true, usdtEnabled: true, usdtNetwork: true, usdtWalletAddress: true },
    });
    const enabled =
      method === PaymentMethod.BANK_QR
        ? Boolean(settings?.qrEnabled && settings.qrImageType)
        : Boolean(settings?.usdtEnabled && settings.usdtNetwork && settings.usdtWalletAddress);
    if (!enabled) throw new BadRequestException(i18nMessage('errors.PAYMENT_METHOD_UNAVAILABLE'));

    if (method === PaymentMethod.BANK_QR && !image) {
      throw new BadRequestException(i18nMessage('errors.IMAGE_REQUIRED'));
    }
    if (method === PaymentMethod.USDT) {
      if (!txId || !isValidTxId(settings?.usdtNetwork ?? null, txId)) {
        throw new BadRequestException(i18nMessage('errors.INVALID_TXID'));
      }
      // El mismo TxID no puede pagar dos pedidos
      const reused = await this.prisma.paymentProof.findFirst({
        where: { txId: { equals: txId, mode: 'insensitive' }, orderId: { not: orderId }, status: { not: PaymentProofStatus.RECHAZADO } },
        select: { id: true },
      });
      if (reused) throw new BadRequestException(i18nMessage('errors.TXID_ALREADY_USED'));
    }

    // Al reemplazar un comprobante sin imagen nueva (USDT) no se conserva la imagen anterior
    const data = { method, txId, image: image?.image ?? null, imageType: image?.imageType ?? null, status: PaymentProofStatus.PENDIENTE };
    await this.prisma.$transaction([
      this.prisma.paymentProof.upsert({ where: { orderId }, create: { orderId, ...data }, update: data }),
      this.prisma.order.update({ where: { id: orderId }, data: { paymentMethod: method } }),
    ]);
    return { success: true, data: { status: PaymentProofStatus.PENDIENTE }, message: 'Comprobante recibido' };
  }

  /** Imagen del comprobante para el panel (respeta el alcance de sucursal del admin). */
  async getImage(orderId: string, actor: AuthUser): Promise<{ data: Buffer; type: string }> {
    await this.orders.findOne(orderId, undefined, actor);
    const proof = await this.prisma.paymentProof.findUnique({ where: { orderId }, select: { image: true, imageType: true } });
    if (!proof?.image || !proof.imageType) throw new NotFoundException();
    return { data: Buffer.from(proof.image), type: proof.imageType };
  }

  async approve(orderId: string, actor: AuthUser) {
    const proof = await this.pendingProof(orderId, actor);
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { orderNumber: true } });
    // Condicionado a PENDIENTE: dos clicks (o dos admins) a la vez no aprueban dos veces
    const { count } = await this.prisma.paymentProof.updateMany({
      where: { orderId, status: PaymentProofStatus.PENDIENTE },
      data: { status: PaymentProofStatus.APROBADO, reviewedById: actor.id, reviewedAt: new Date() },
    });
    if (count === 0) throw new BadRequestException(i18nMessage('errors.PROOF_NOT_PENDING'));
    // Mismo cierre que un pago con tarjeta: Payment COMPLETADO, pedido PROCESANDO, carrito cerrado, factura
    await this.payments.markQrPaymentSucceeded(orderId, proof.txId ?? `${proof.method}-${order.orderNumber}`, proof.method);
    return this.orders.findOne(orderId, undefined, actor);
  }

  async reject(orderId: string, actor: AuthUser) {
    await this.pendingProof(orderId, actor);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.paymentProof.updateMany({
        where: { orderId, status: PaymentProofStatus.PENDIENTE },
        data: { status: PaymentProofStatus.RECHAZADO, reviewedById: actor.id, reviewedAt: new Date() },
      });
      if (count === 0) throw new BadRequestException(i18nMessage('errors.PROOF_NOT_PENDING'));
      await tx.order.update({ where: { id: orderId }, data: { paymentStatus: PaymentStatus.FALLIDO } });
    });
    // Cancela el pedido y repone el stock que tenía reservado
    return this.orders.cancel(orderId, undefined, actor);
  }

  private async pendingProof(orderId: string, actor: AuthUser) {
    await this.orders.findOne(orderId, undefined, actor);
    const proof = await this.prisma.paymentProof.findUnique({ where: { orderId }, select: { status: true, method: true, txId: true } });
    if (!proof || proof.status !== PaymentProofStatus.PENDIENTE) {
      throw new BadRequestException(i18nMessage('errors.PROOF_NOT_PENDING'));
    }
    return proof;
  }
}
