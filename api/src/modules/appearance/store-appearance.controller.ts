import { Body, Controller, Get, Patch, Put, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/decorators/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/decorators/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/constants/permissions';
import type { UploadedImage } from '../payments/payment-settings.service';
import { APPEARANCE_IMAGE_LIMITS, StoreAppearanceService } from './store-appearance.service';
import { UpdateStoreAppearanceDto } from './dto/store-appearance.dto';

// multer corta la subida apenas pasa el límite de cada imagen (no se lee entera en memoria)
const upload = (max: number) => FileInterceptor('file', { limits: { fileSize: max, files: 1 } });

// Apariencia de la tienda pública (logo, colores, descripción, redes). La tienda es la del request
// (TenantMiddleware) y la del JWT, que JwtStrategy exige que coincidan.
@ApiTags('store-appearance')
@ApiBearerAuth('JWT-auth')
@Controller('admin/settings/appearance')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions(Permission.MANAGE_APPEARANCE)
export class StoreAppearanceController {
  constructor(private readonly appearance: StoreAppearanceService) {}

  @Get()
  @ApiOperation({ summary: 'Apariencia actual de la tienda (la crea con valores por defecto si no existe)' })
  async get() {
    return { success: true, data: await this.appearance.get(), message: 'OK' };
  }

  @Patch()
  @ApiOperation({ summary: 'Actualizar colores, descripción, redes sociales e imágenes (URL externa o null)' })
  async update(@Body() dto: UpdateStoreAppearanceDto) {
    return { success: true, data: await this.appearance.update(dto), message: 'Apariencia actualizada' };
  }

  @Put('logo')
  @UseInterceptors(upload(APPEARANCE_IMAGE_LIMITS.logo))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Subir el logo (PNG, JPEG o WebP, máx. 256 KB)' })
  async uploadLogo(@UploadedFile() file: UploadedImage | undefined) {
    return { success: true, data: await this.appearance.setImage('logo', file), message: 'Logo actualizado' };
  }

  @Put('favicon')
  @UseInterceptors(upload(APPEARANCE_IMAGE_LIMITS.favicon))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Subir el favicon (PNG, JPEG o WebP, máx. 64 KB)' })
  async uploadFavicon(@UploadedFile() file: UploadedImage | undefined) {
    return { success: true, data: await this.appearance.setImage('favicon', file), message: 'Favicon actualizado' };
  }

  @Put('background')
  @UseInterceptors(upload(APPEARANCE_IMAGE_LIMITS.background))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Subir la imagen de fondo de la tienda (PNG, JPEG o WebP, máx. 512 KB)' })
  async uploadBackground(@UploadedFile() file: UploadedImage | undefined) {
    return { success: true, data: await this.appearance.setImage('background', file), message: 'Fondo actualizado' };
  }
}

// Vitrina pública: la lee el layout del front (Server Component) para colores, logo y metadatos
@ApiTags('store-appearance')
@Controller('store/appearance')
export class PublicStoreAppearanceController {
  constructor(private readonly appearance: StoreAppearanceService) {}

  @Get()
  @ApiOperation({ summary: 'Apariencia pública de la tienda actual' })
  async get() {
    return { success: true, data: await this.appearance.getPublic(), message: 'OK' };
  }
}
