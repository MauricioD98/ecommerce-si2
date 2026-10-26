import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { UsdtNetwork } from '@prisma/client';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../prisma/prisma.service';
import { i18nMessage } from '../../i18n/i18n-message';
import { StripeConnectService } from './stripe-connect.service';
import { UpdatePaymentSettingsDto } from './dto/payment-settings.dto';

const SETTINGS_ID = 'default';
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

// Sin la imagen: solo se lee completa en el endpoint que la sirve
const SETTINGS_SELECT = {
  qrEnabled: true,
  qrImageType: true,
  qrInstructions: true,
  usdtEnabled: true,
  usdtNetwork: true,
  usdtWalletAddress: true,
  updatedAt: true,
} as const;

export interface UploadedImage {
  buffer: Buffer;
  size: number;
}

/**
 * Tipo real de la imagen por sus primeros bytes (no por el Content-Type que manda el navegador,
 * que el cliente controla). Solo PNG, JPEG y WebP: es lo que se va a mostrar en un <img>.
 */
export function detectImageType(file?: UploadedImage): string {
  if (!file?.buffer?.length) throw new BadRequestException(i18nMessage('errors.IMAGE_REQUIRED'));
  if (file.size > MAX_IMAGE_BYTES) throw new BadRequestException(i18nMessage('errors.IMAGE_TOO_LARGE'));
  const b = file.buffer;
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  throw new BadRequestException(i18nMessage('errors.INVALID_IMAGE'));
}

// TRC20 (Tron): base58 que empieza con T. ERC20/BEP20/Polygon: dirección EVM 0x + 40 hex.
export function isValidWallet(network: UsdtNetwork, address: string): boolean {
  return network === UsdtNetwork.TRC20 ? /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address) : /^0x[a-fA-F0-9]{40}$/.test(address);
}

// Hash de la transacción: Tron son 64 hex sin prefijo; las redes EVM, 0x + 64 hex
export function isValidTxId(network: UsdtNetwork | null, txId: string): boolean {
  if (network === UsdtNetwork.TRC20) return /^[a-fA-F0-9]{64}$/.test(txId);
  if (network) return /^0x[a-fA-F0-9]{64}$/.test(txId);
  return /^(0x)?[a-fA-F0-9]{64}$/.test(txId);
}

@Injectable()
export class PaymentSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly connect: StripeConnectService,
  ) {}

  private async read() {
    return this.prisma.paymentSettings.findUnique({ where: { id: SETTINGS_ID }, select: SETTINGS_SELECT });
  }

  /** Panel de la tienda: los tres medios de cobro. */
  async getForAdmin(tenantId: string) {
    const [settings, stripe, accountId] = await Promise.all([
      this.read(),
      this.connect.getStatus(tenantId),
      this.connect.getAccountId(tenantId),
    ]);
    return {
      stripe: { ...stripe, accountId },
      qr: {
        enabled: settings?.qrEnabled ?? false,
        hasImage: Boolean(settings?.qrImageType),
        instructions: settings?.qrInstructions ?? '',
      },
      usdt: {
        enabled: settings?.usdtEnabled ?? false,
        network: settings?.usdtNetwork ?? null,
        walletAddress: settings?.usdtWalletAddress ?? '',
      },
    };
  }

  /**
   * Guarda QR y USDT. Un medio solo se puede activar completo: QR con imagen, USDT con red y una
   * dirección válida para esa red (una wallet mal copiada manda los fondos a ningún lado).
   */
  async update(dto: UpdatePaymentSettingsDto): Promise<void> {
    const current = await this.read();
    const next = {
      qrEnabled: dto.qrEnabled ?? current?.qrEnabled ?? false,
      qrInstructions: dto.qrInstructions !== undefined ? dto.qrInstructions.trim() || null : current?.qrInstructions ?? null,
      usdtEnabled: dto.usdtEnabled ?? current?.usdtEnabled ?? false,
      usdtNetwork: dto.usdtNetwork !== undefined ? dto.usdtNetwork : current?.usdtNetwork ?? null,
      usdtWalletAddress:
        dto.usdtWalletAddress !== undefined ? dto.usdtWalletAddress.trim() || null : current?.usdtWalletAddress ?? null,
    };

    if (next.qrEnabled && !current?.qrImageType) throw new BadRequestException(i18nMessage('errors.QR_IMAGE_MISSING'));
    if (next.usdtWalletAddress && next.usdtNetwork && !isValidWallet(next.usdtNetwork, next.usdtWalletAddress)) {
      throw new BadRequestException(i18nMessage('errors.INVALID_WALLET', { network: next.usdtNetwork }));
    }
    if (next.usdtEnabled && (!next.usdtNetwork || !next.usdtWalletAddress)) {
      throw new BadRequestException(i18nMessage('errors.USDT_SETTINGS_INCOMPLETE'));
    }

    await this.prisma.paymentSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...next },
      update: next,
    });
  }

  async setQrImage(file?: UploadedImage): Promise<void> {
    const type = detectImageType(file);
    const data = { qrImage: new Uint8Array(file!.buffer), qrImageType: type };
    await this.prisma.paymentSettings.upsert({ where: { id: SETTINGS_ID }, create: { id: SETTINGS_ID, ...data }, update: data });
  }

  // Sin imagen el QR no se puede ofrecer: se desactiva junto con ella
  async removeQrImage(): Promise<void> {
    await this.prisma.paymentSettings.updateMany({
      where: { id: SETTINGS_ID },
      data: { qrImage: null, qrImageType: null, qrEnabled: false },
    });
  }

  // onlyEnabled: el checkout público solo ve el QR mientras la tienda lo tenga activo
  async getQrImage(onlyEnabled = false): Promise<{ data: Buffer; type: string }> {
    const row = await this.prisma.paymentSettings.findUnique({
      where: { id: SETTINGS_ID },
      select: { qrImage: true, qrImageType: true, qrEnabled: true },
    });
    if (!row?.qrImage || !row.qrImageType || (onlyEnabled && !row.qrEnabled)) throw new NotFoundException();
    return { data: Buffer.from(row.qrImage), type: row.qrImageType };
  }

  /** Checkout público: solo los medios activos y completos, sin nada interno de la tienda. */
  async getPublicOptions(tenantId: string) {
    const [settings, cardEnabled] = await Promise.all([this.read(), this.connect.isCardEnabled(tenantId)]);
    const qrReady = Boolean(settings?.qrEnabled && settings.qrImageType);
    const usdtReady = Boolean(settings?.usdtEnabled && settings.usdtNetwork && settings.usdtWalletAddress);
    return {
      card: cardEnabled,
      bankQr: qrReady ? { instructions: settings!.qrInstructions ?? '' } : null,
      usdt: usdtReady
        ? {
            network: settings!.usdtNetwork!,
            walletAddress: settings!.usdtWalletAddress!,
            // QR con la dirección (lo que leen las wallets al escanear); se genera acá para no sumar dependencias al front
            walletQr: await QRCode.toDataURL(settings!.usdtWalletAddress!, { margin: 1, width: 240 }),
          }
        : null,
    };
  }
}
