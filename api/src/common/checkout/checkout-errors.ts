import { HttpException, HttpStatus } from '@nestjs/common';
import { i18nMessage } from '../../i18n/i18n-message';

// Códigos estables del contrato de compra: los clientes (web y móvil) deciden por `code`, nunca por el texto
export const CheckoutCode = {
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  CART_VERSION_CONFLICT: 'CART_VERSION_CONFLICT',
  PRICE_CHANGED: 'PRICE_CHANGED',
  ATTEMPT_IN_PROGRESS: 'ATTEMPT_IN_PROGRESS',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  RESERVATION_EXPIRED: 'RESERVATION_EXPIRED',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  ATTEMPT_NOT_FOUND: 'ATTEMPT_NOT_FOUND',
  ORDER_ALREADY_PAID: 'ORDER_ALREADY_PAID',
  ORDER_NOT_PAYABLE: 'ORDER_NOT_PAYABLE',
  PAYMENT_MISMATCH: 'PAYMENT_MISMATCH',
  PAYMENT_SIMULATION_DISABLED: 'PAYMENT_SIMULATION_DISABLED',
  INVENTORY_VERSION_CONFLICT: 'INVENTORY_VERSION_CONFLICT',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
} as const;
export type CheckoutCodeValue = (typeof CheckoutCode)[keyof typeof CheckoutCode];

export class CheckoutException extends HttpException {
  constructor(
    readonly code: CheckoutCodeValue,
    status: HttpStatus = HttpStatus.CONFLICT,
    args: Record<string, unknown> = {},
    extra: Record<string, unknown> = {},
  ) {
    super({ code, message: i18nMessage(`errors.${code}`, args), ...extra }, status);
  }
}

export const outOfStock = (size: string, productId?: string) =>
  new CheckoutException(CheckoutCode.OUT_OF_STOCK, HttpStatus.CONFLICT, { size }, { productId, size });
