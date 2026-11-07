import { assertPlanFeature } from '../platform/plans';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, PaymentAttemptStatus, PaymentMethod, PaymentProofStatus, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { i18nMessage } from '../../i18n/i18n-message';
import type { AuthUser } from '../../common/decorators/interfaces/request-with-user.interface';
import { OrdersService } from '../orders/orders.service';
import { PaymentsService } from './payments.service';
import { PaymentSettlementService } from './payment-settlement.service';
import { CheckoutCode, CheckoutException } from '../../common/checkout/checkout-errors';
import { lockOrder, withTxRetry } from '../../common/checkout/tx.util';
import { MANUAL_PAYMENT_METHODS } from '../../common/checkout/checkout-policy';
import { UploadedImage, detectImageType, isValidTxId, isWalletReady } from './payment-settings.service';

/**
 * Pagos manuales (QR bancario, USDT y billetera): el cliente informa el pago y la tienda lo verifica desde
 * Pedidos. Hasta que se aprueba, el pedido queda PENDIENTE con su stock reservado; si se rechaza,
 * se cancela y el stock vuelve (OrdersService.cancel).
 */
@Injectable()
export class PaymentProofsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    private readonly settlement: PaymentSettlementService,
  ) {}

  /** El cliente sube el comprobante (QR) o el TxID (USDT). Se puede reemplazar mientras no se revisó. */
  async submit(orderId: string, userId: string, method: PaymentMethod, txIdRaw: string | undefined, file?: UploadedImage) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      select: { id: true, status: true, paymentStatus: true, paymentProof: { select: { status: true } } },
    });
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    if (
      !MANUAL_PAYMENT_METHODS.includes(method) ||
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
      select: { qrEnabled: true, qrImageType: true, usdtEnabled: true, usdtNetwork: true, usdtWalletAddress: true, walletEnabled: true, walletProvider: true, walletAccount: true },
    });
    const enabled =
      method === PaymentMethod.BANK_QR
        ? Boolean(settings?.qrEnabled && settings.qrImageType)
        : method === PaymentMethod.USDT
        ? Boolean(settings?.usdtEnabled && settings.usdtNetwork && settings.usdtWalletAddress)
        : isWalletReady(settings);
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
    if (method === PaymentMethod.BANK_QR) {
      assertPlanFeature('qrPayments');
    }
    if (method === PaymentMethod.WALLET) {
      assertPlanFeature('digitalWallet');
      if (!txId || txId.length < 3) {
        throw new BadRequestException('El ID o número de referencia de la transferencia es obligatorio');
      }
      const reused = await this.prisma.paymentProof.findFirst({
        where: { txId: { equals: txId, mode: 'insensitive' }, orderId: { not: orderId }, status: { not: PaymentProofStatus.RECHAZADO } },
        select: { id: true },
      });
      if (reused) throw new BadRequestException('Este ID de transacción ya fue utilizado para otro pedido');
    }

    // Cambio de método: un cobro con tarjeta abierto se resuelve antes. Si el proveedor ya tiene el dinero
    // o no se sabe, no se acepta el comprobante: la orden tendría dos liquidaciones posibles.
    const provider = await this.payments.resolveProviderBeforeRelease(orderId);
    if (provider !== 'FREE') {
      throw new CheckoutException(provider === 'PAID' ? CheckoutCode.ORDER_ALREADY_PAID : CheckoutCode.PAYMENT_PENDING);
    }

    // Al reemplazar un comprobante sin imagen nueva (USDT) no se conserva la imagen anterior
    const data = { method, txId, image: image?.image ?? null, imageType: image?.imageType ?? null, status: PaymentProofStatus.PENDIENTE };
    try {
      await withTxRetry(() =>
        this.prisma.$transaction(async (tx) => {
          await lockOrder(tx, orderId);
          const current = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true, paymentStatus: true } });
          if (current.status !== OrderStatus.PENDIENTE || current.paymentStatus === PaymentStatus.COMPLETADO) {
            throw new BadRequestException(i18nMessage('errors.ORDER_NOT_AWAITING_PROOF'));
          }
          await tx.paymentAttempt.updateMany({
            where: { orderId, status: { in: [PaymentAttemptStatus.CREATED, PaymentAttemptStatus.OPEN] } },
            data: { status: PaymentAttemptStatus.CANCELED },
          });
          await tx.paymentProof.upsert({ where: { orderId }, create: { orderId, ...data }, update: data });
          await tx.order.update({ where: { id: orderId }, data: { paymentMethod: method } });
        }),
      );
    } catch (error) {
      // El índice único por TxID resuelve la carrera que la lectura de arriba no puede ver
      if ((error as { code?: string })?.code === 'P2002') throw new BadRequestException(i18nMessage('errors.TXID_ALREADY_USED'));
      throw error;
    }
    return { success: true, data: { status: PaymentProofStatus.PENDIENTE }, message: 'Comprobante recibido' };
  }

  /** Imagen del comprobante para el panel (respeta el alcance de sucursal del admin). */
  async getImage(orderId: string, actor: AuthUser): Promise<{ data: Buffer; type: string }> {
    await this.orders.findOne(orderId, undefined, actor);
    const proof = await this.prisma.paymentProof.findUnique({ where: { orderId }, select: { image: true, imageType: true } });
    if (!proof?.image || !proof.imageType) throw new NotFoundException();
    return { data: Buffer.from(proof.image), type: proof.imageType };
  }

  // Aprobar y rechazar compiten por la misma fila bloqueada: una sola transición y una sola contabilización
  async approve(orderId: string, actor: AuthUser) {
    await this.orders.findOne(orderId, undefined, actor);
    await withTxRetry(() =>
      this.prisma.$transaction(async (tx) => {
        await lockOrder(tx, orderId);
        const proof = await tx.paymentProof.findUnique({ where: { orderId }, select: { status: true, method: true, txId: true } });
        const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { orderNumber: true, status: true } });
        if (!proof || proof.status !== PaymentProofStatus.PENDIENTE) throw new BadRequestException(i18nMessage('errors.PROOF_NOT_PENDING'));
        if (order.status === OrderStatus.CANCELADO) throw new CheckoutException(CheckoutCode.ORDER_NOT_PAYABLE);
        await tx.paymentProof.update({
          where: { orderId },
          data: { status: PaymentProofStatus.APROBADO, reviewedById: actor.id, reviewedAt: new Date() },
        });
        // Mismo cierre que un pago con tarjeta: Payment COMPLETADO, pedido PROCESANDO, factura por outbox
        await this.settlement.settleInTx(tx, {
          orderId,
          method: proof.method,
          transactionId: proof.txId ?? `${proof.method}-${order.orderNumber}`,
          currency: proof.method === PaymentMethod.USDT ? 'USDT' : 'BOB',
        });
      }),
    );
    return this.orders.findOne(orderId, undefined, actor);
  }

  async reject(orderId: string, actor: AuthUser) {
    await this.orders.findOne(orderId, undefined, actor);
    await withTxRetry(() =>
      this.prisma.$transaction(async (tx) => {
        await lockOrder(tx, orderId);
        const proof = await tx.paymentProof.findUnique({ where: { orderId }, select: { status: true } });
        if (!proof || proof.status !== PaymentProofStatus.PENDIENTE) throw new BadRequestException(i18nMessage('errors.PROOF_NOT_PENDING'));
        await tx.paymentProof.update({
          where: { orderId },
          data: { status: PaymentProofStatus.RECHAZADO, reviewedById: actor.id, reviewedAt: new Date() },
        });
        await tx.order.update({ where: { id: orderId }, data: { paymentStatus: PaymentStatus.FALLIDO } });
        // Cancela el pedido y repone el stock que tenía reservado, una sola vez
        await this.settlement.cancelInTx(tx, orderId, 'PROOF_REJECTED');
      }),
    );
    return this.orders.findOne(orderId, undefined, actor);
  }


}
