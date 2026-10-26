import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { i18nMessage } from '../../i18n/i18n-message';
import { detectImageType, UploadedImage } from '../payments/payment-settings.service';
import { UpdateStoreAppearanceDto } from './dto/store-appearance.dto';

const APPEARANCE_ID = 'default';

// Las imágenes se guardan como data URL y viajan en cada GET público: por eso los límites son mucho
// más chicos que los 2 MB del QR de pagos. El fondo no llega al HTML (el front lo sirve aparte), pero sí
// a la caché de datos de Next, que no guarda respuestas de más de 2 MB.
export const APPEARANCE_IMAGE_LIMITS = {
  logo: 256 * 1024,
  favicon: 64 * 1024,
  background: 512 * 1024,
} as const;

const IMAGE_FIELDS = {
  logo: 'logoUrl',
  favicon: 'faviconUrl',
  background: 'storeBackgroundImage',
} as const;
export type AppearanceImageKind = keyof typeof APPEARANCE_IMAGE_LIMITS;

const PUBLIC_SELECT = {
  logoUrl: true,
  faviconUrl: true,
  primaryColor: true,
  secondaryColor: true,
  description: true,
  socialLinks: true,
  fontFamily: true,
  navbarBackgroundColor: true,
  navbarTextColor: true,
  searchBarBackgroundColor: true,
  storeBackgroundColor: true,
  storeBackgroundImage: true,
  adminMenuColor: true,
  updatedAt: true,
} as const;

// Mismos defaults que el schema: lo que ve una tienda que nunca guardó su apariencia
const DEFAULT_APPEARANCE = {
  logoUrl: null,
  faviconUrl: null,
  primaryColor: '#000000',
  secondaryColor: '#ffffff',
  description: null,
  socialLinks: null,
  fontFamily: 'Inter',
  navbarBackgroundColor: '#ffffff',
  navbarTextColor: '#000000',
  searchBarBackgroundColor: '#333333',
  storeBackgroundColor: '#ffffff',
  storeBackgroundImage: null,
  adminMenuColor: '#1a1a1a',
  updatedAt: null,
};

const hex = (value?: string) => value?.toLowerCase();

@Injectable()
export class StoreAppearanceService {
  constructor(private readonly prisma: PrismaService) {}

  /** Configuración actual; si la tienda nunca la guardó, se crea con los valores por defecto. */
  async get() {
    return this.prisma.storeAppearance.upsert({
      where: { id: APPEARANCE_ID },
      create: { id: APPEARANCE_ID },
      update: {},
      select: PUBLIC_SELECT,
    });
  }

  /** Vitrina pública: solo lee (cada visita pasa por acá); sin fila, los mismos valores por defecto. */
  async getPublic() {
    const row = await this.prisma.storeAppearance.findUnique({ where: { id: APPEARANCE_ID }, select: PUBLIC_SELECT });
    return row ?? DEFAULT_APPEARANCE;
  }

  async update(dto: UpdateStoreAppearanceDto) {
    const data: Prisma.StoreAppearanceUpdateInput = {
      primaryColor: hex(dto.primaryColor),
      secondaryColor: hex(dto.secondaryColor),
      navbarBackgroundColor: hex(dto.navbarBackgroundColor),
      navbarTextColor: hex(dto.navbarTextColor),
      searchBarBackgroundColor: hex(dto.searchBarBackgroundColor),
      storeBackgroundColor: hex(dto.storeBackgroundColor),
      adminMenuColor: hex(dto.adminMenuColor),
      fontFamily: dto.fontFamily,
      storeBackgroundImage: dto.storeBackgroundImage,
      description: dto.description !== undefined ? dto.description.trim() || null : undefined,
      logoUrl: dto.logoUrl,
      faviconUrl: dto.faviconUrl,
      // Prisma distingue el JSON null (DbNull) de "no tocar" (undefined)
      socialLinks:
        dto.socialLinks === undefined
          ? undefined
          : dto.socialLinks === null || dto.socialLinks.length === 0
            ? Prisma.DbNull
            : dto.socialLinks.map(({ platform, url }) => ({ platform, url: url.trim() })),
    };
    return this.prisma.storeAppearance.upsert({
      where: { id: APPEARANCE_ID },
      create: { id: APPEARANCE_ID, ...(data as Prisma.StoreAppearanceCreateInput) },
      update: data,
      select: PUBLIC_SELECT,
    });
  }

  /** Logo, favicon o fondo subido desde el panel: se valida por sus bytes y se guarda como data URL. */
  async setImage(kind: AppearanceImageKind, file?: UploadedImage) {
    const max = APPEARANCE_IMAGE_LIMITS[kind];
    if (file && file.size > max) {
      throw new BadRequestException(i18nMessage('errors.APPEARANCE_IMAGE_TOO_LARGE', { max: max / 1024 }));
    }
    const type = detectImageType(file);
    const dataUrl = `data:${type};base64,${file!.buffer.toString('base64')}`;
    const field = IMAGE_FIELDS[kind];
    return this.prisma.storeAppearance.upsert({
      where: { id: APPEARANCE_ID },
      create: { id: APPEARANCE_ID, [field]: dataUrl },
      update: { [field]: dataUrl },
      select: PUBLIC_SELECT,
    });
  }
}
