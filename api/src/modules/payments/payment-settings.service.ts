import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { UsdtNetwork } from '@prisma/client';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../prisma/prisma.service';
import { ControlPrismaService } from '../../tenancy/control-prisma.service';
import { tenantStorage } from '../../tenancy/tenant-context';
import { i18nMessage } from '../../i18n/i18n-message';
import { assertPlanFeature, currentPlanFeatures } from '../platform/plans';
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
  walletEnabled: true,
  walletProvider: true,
  walletAccount: true,
  walletInstructions: true,
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
    private readonly control: ControlPrismaService,
  ) {}

  private async read(tenantId?: string) {
    let settings = await this.prisma.paymentSettings.findUnique({ where: { id: SETTINGS_ID }, select: SETTINGS_SELECT });
    const walletAllowed = currentPlanFeatures().digitalWallet;

    if (walletAllowed && (!settings || !settings.walletAccount)) {
      const resolvedTenantId = tenantId ?? tenantStorage.getStore()?.tenantId;
      let slug = 'mitienda';
      if (resolvedTenantId) {
        try {
          const tenant = await this.control.tenant.findUnique({
            where: { id: resolvedTenantId },
            select: { slug: true },
          });
          if (tenant?.slug) slug = tenant.slug;
        } catch {}
      }

      const defaultAccount = `@${slug} / pagos@${slug}.com`;
      const defaultProvider = 'Airtm / Takenos / Wallbit';
      const defaultInstructions =
        'Transfiere el monto desde tu cuenta Airtm, Takenos o Wallbit a nuestro usuario/correo. Luego ingresa el ID de transacción o referencia de la transferencia.';

      settings = await this.prisma.paymentSettings.upsert({
        where: { id: SETTINGS_ID },
        create: {
          id: SETTINGS_ID,
          walletEnabled: true,
          walletProvider: defaultProvider,
          walletAccount: defaultAccount,
          walletInstructions: defaultInstructions,
        },
        update: {
          walletEnabled: settings?.walletEnabled ?? true,
          walletProvider: settings?.walletProvider || defaultProvider,
          walletAccount: settings?.walletAccount || defaultAccount,
          walletInstructions: settings?.walletInstructions || defaultInstructions,
        },
        select: SETTINGS_SELECT,
      });
    }

    return settings;
  }

  /** Panel de la tienda: los medios de cobro y si el plan incluye QR. */
  async getForAdmin(tenantId: string) {
    const [settings, stripe, accountId] = await Promise.all([
      this.read(tenantId),
      this.connect.getStatus(tenantId),
      this.connect.getAccountId(tenantId),
    ]);
    const qrAllowed = currentPlanFeatures().qrPayments;
    const walletAllowed = currentPlanFeatures().digitalWallet;
    return {
      stripe: { ...stripe, accountId },
      qr: {
        allowed: qrAllowed,
        enabled: qrAllowed ? (settings?.qrEnabled ?? false) : false,
        hasImage: Boolean(settings?.qrImageType),
        instructions: settings?.qrInstructions ?? '',
      },
      usdt: {
        enabled: settings?.usdtEnabled ?? false,
        network: settings?.usdtNetwork ?? null,
        walletAddress: settings?.usdtWalletAddress ?? '',
      },
      wallet: {
        allowed: walletAllowed,
        enabled: walletAllowed ? (settings?.walletEnabled ?? false) : false,
        provider: settings?.walletProvider ?? 'AIRTM, TAKENOS, WALLBIT',
        account: settings?.walletAccount ?? '',
        instructions: settings?.walletInstructions ?? '',
      },
    };
  }

  /**
   * Guarda QR, USDT y Billetera Digital. Un medio solo se puede activar completo: QR con imagen (solo Plan Pro),
   * USDT con red y una dirección válida para esa red.
   */
  async update(dto: UpdatePaymentSettingsDto): Promise<void> {
    if (dto.qrEnabled !== undefined || dto.qrInstructions !== undefined) {
      assertPlanFeature('qrPayments');
    }
    if (
      dto.walletEnabled !== undefined ||
      dto.walletProvider !== undefined ||
      dto.walletAccount !== undefined ||
      dto.walletInstructions !== undefined
    ) {
      assertPlanFeature('digitalWallet');
    }

    const current = await this.read();
    const next = {
      qrEnabled: dto.qrEnabled ?? current?.qrEnabled ?? false,
      qrInstructions: dto.qrInstructions !== undefined ? dto.qrInstructions.trim() || null : current?.qrInstructions ?? null,
      usdtEnabled: dto.usdtEnabled ?? current?.usdtEnabled ?? false,
      usdtNetwork: dto.usdtNetwork !== undefined ? dto.usdtNetwork : current?.usdtNetwork ?? null,
      usdtWalletAddress:
        dto.usdtWalletAddress !== undefined ? dto.usdtWalletAddress.trim() || null : current?.usdtWalletAddress ?? null,
      walletEnabled: dto.walletEnabled ?? current?.walletEnabled ?? false,
      walletProvider: dto.walletProvider !== undefined ? dto.walletProvider.trim() || null : current?.walletProvider ?? null,
      walletAccount: dto.walletAccount !== undefined ? dto.walletAccount.trim() || null : current?.walletAccount ?? null,
      walletInstructions: dto.walletInstructions !== undefined ? dto.walletInstructions.trim() || null : current?.walletInstructions ?? null,
    };

    if (next.walletEnabled && !next.walletAccount) {
      throw new BadRequestException('Debes ingresar la cuenta o alias de cobro para activar la billetera digital');
    }

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
    assertPlanFeature('qrPayments');
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

  // onlyEnabled: el checkout público solo ve el QR mientras la tienda lo tenga activo y el plan sea Pro
  async getQrImage(onlyEnabled = false): Promise<{ data: Buffer; type: string }> {
    if (onlyEnabled && !currentPlanFeatures().qrPayments) throw new NotFoundException();
    const row = await this.prisma.paymentSettings.findUnique({
      where: { id: SETTINGS_ID },
      select: { qrImage: true, qrImageType: true, qrEnabled: true },
    });
    if (!row?.qrImage || !row.qrImageType || (onlyEnabled && !row.qrEnabled)) throw new NotFoundException();
    return { data: Buffer.from(row.qrImage), type: row.qrImageType };
  }

  /** Checkout público: solo los medios activos y permitidos por el plan actual de la tienda. */
  async getPublicOptions(tenantId: string) {
    const [settings, cardEnabled] = await Promise.all([this.read(tenantId), this.connect.isCardEnabled(tenantId)]);
    const qrAllowed = currentPlanFeatures().qrPayments;
    const walletAllowed = currentPlanFeatures().digitalWallet;
    const qrReady = qrAllowed && Boolean(settings?.qrEnabled && settings.qrImageType);
    const usdtReady = Boolean(settings?.usdtEnabled && settings.usdtNetwork && settings.usdtWalletAddress);
    const walletReady = walletAllowed && Boolean(settings?.walletEnabled && settings.walletAccount);
    return {
      card: cardEnabled,
      qrAllowed,
      walletAllowed,
      bankQr: qrReady ? { instructions: settings!.qrInstructions ?? '' } : null,
      usdt: usdtReady
        ? {
            network: settings!.usdtNetwork!,
            walletAddress: settings!.usdtWalletAddress!,
            walletQr: await QRCode.toDataURL(settings!.usdtWalletAddress!, { margin: 1, width: 240 }),
          }
        : null,
      wallet: walletReady
        ? {
            provider: settings!.walletProvider ?? 'AIRTM, TAKENOS, WALLBIT',
            account: settings!.walletAccount!,
            instructions: settings!.walletInstructions ?? '',
          }
        : null,
    };
  }
}
