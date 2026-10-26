import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import Stripe from 'stripe';
import { JwtAuthGuard } from '../../common/decorators/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/decorators/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/constants/permissions';
import { GetUser } from '../../common/decorators/get-user.decorator';
import type { AuthUser } from '../../common/decorators/interfaces/request-with-user.interface';
import { requireTenant, withTenantParam } from '../../tenancy/tenant-context';
import { i18nMessage } from '../../i18n/i18n-message';
import { StripeConnectService } from './stripe-connect.service';
import { MAX_IMAGE_BYTES, PaymentSettingsService, UploadedImage } from './payment-settings.service';
import { PaymentProofsService } from './payment-proofs.service';
import { SubmitPaymentProofDto, UpdatePaymentSettingsDto } from './dto/payment-settings.dto';

// multer corta la subida apenas pasa el límite (no se lee entera en memoria)
const imageUpload = FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } });

const sendImage = (res: Response, image: { data: Buffer; type: string }, cache: string) => {
  res.setHeader('Content-Type', image.type);
  res.setHeader('Cache-Control', cache);
  // Bytes subidos por usuarios: nunca se interpretan como otro tipo
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(image.data);
};

// Gestión de pagos de la tienda (Stripe Connect, QR bancario, USDT). La tienda es la del request
// (TenantMiddleware) y la del JWT, que JwtStrategy exige que coincidan.
@ApiTags('payment-settings')
@ApiBearerAuth('JWT-auth')
@Controller('admin/settings/payments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions(Permission.MANAGE_PAYMENTS)
export class PaymentSettingsController {
  private readonly logger = new Logger(PaymentSettingsController.name);

  constructor(
    private readonly settings: PaymentSettingsService,
    private readonly connect: StripeConnectService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Medios de cobro de la tienda' })
  async get(@GetUser() user: AuthUser) {
    return { success: true, data: await this.settings.getForAdmin(user.tenantId), message: 'OK' };
  }

  @Patch()
  @ApiOperation({ summary: 'Configurar QR bancario y USDT' })
  async update(@Body() dto: UpdatePaymentSettingsDto, @GetUser() user: AuthUser) {
    await this.settings.update(dto);
    return { success: true, data: await this.settings.getForAdmin(user.tenantId), message: 'Medios de cobro actualizados' };
  }

  @Put('qr-image')
  @UseInterceptors(imageUpload)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Subir la imagen del QR bancario (PNG, JPEG o WebP, máx. 2 MB)' })
  async uploadQr(@UploadedFile() file: UploadedImage | undefined) {
    await this.settings.setQrImage(file);
    return { success: true, data: null, message: 'QR actualizado' };
  }

  @Delete('qr-image')
  @ApiOperation({ summary: 'Quitar la imagen del QR (desactiva el QR)' })
  async removeQr() {
    await this.settings.removeQrImage();
    return { success: true, data: null, message: 'QR eliminado' };
  }

  @Get('qr-image')
  @ApiOperation({ summary: 'Imagen del QR bancario (vista previa del panel)' })
  async qrImage(@Res() res: Response) {
    sendImage(res, await this.settings.getQrImage(), 'private, no-store');
  }

  // Crea (si hace falta) la cuenta Express y devuelve el formulario de Stripe para completar los datos
  @Post('stripe/onboarding')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Abrir el onboarding de Stripe Connect' })
  async stripeOnboarding(@GetUser() user: AuthUser) {
    const base = `${(process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '')}/admin/settings/payments`;
    try {
      const data = await this.connect.createOnboardingLink(
        user.tenantId,
        withTenantParam(`${base}?connect=return`, user.tenantId),
        // El link de Stripe vence a los pocos minutos: refresh_url vuelve al panel para pedir otro
        withTenantParam(`${base}?connect=refresh`, user.tenantId),
      );
      return { success: true, data, message: 'Redirigiendo a Stripe' };
    } catch (error) {
      // Cuenta de Stripe sin Connect activado: se explica en vez de devolver un 500 genérico
      if (error instanceof Stripe.errors.StripeError) {
        this.logger.error(`Onboarding de Connect falló: ${error.message}`);
        if (/signed up for Connect/i.test(error.message)) throw new BadRequestException(i18nMessage('errors.CONNECT_NOT_ENABLED'));
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  @Delete('stripe')
  @ApiOperation({ summary: 'Desvincular la cuenta de Stripe (deja de cobrar con tarjeta)' })
  async stripeDisconnect(@GetUser() user: AuthUser) {
    await this.connect.disconnect(user.tenantId);
    return { success: true, data: await this.settings.getForAdmin(user.tenantId), message: 'Cuenta de Stripe desvinculada' };
  }
}

// Checkout público de la tienda: qué medios de cobro ofrecer (sin datos internos)
@ApiTags('payment-settings')
@Controller('store/payment-options')
export class PaymentOptionsController {
  constructor(private readonly settings: PaymentSettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Medios de pago activos de la tienda' })
  async options() {
    const { tenantId } = requireTenant();
    return { success: true, data: await this.settings.getPublicOptions(tenantId), message: 'OK' };
  }

  @Get('qr-image')
  @ApiOperation({ summary: 'Imagen del QR bancario de la tienda' })
  async qrImage(@Res() res: Response) {
    // Corto: si la tienda cambia el QR, los clientes no deben seguir viendo el viejo
    sendImage(res, await this.settings.getQrImage(true), 'public, max-age=60');
  }
}

// Comprobantes de pagos manuales: el cliente los sube; la tienda los aprueba o rechaza en Pedidos
@ApiTags('orders')
@ApiBearerAuth('JWT-auth')
@Controller('orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PaymentProofsController {
  constructor(private readonly proofs: PaymentProofsService) {}

  @Post(':id/payment-proof')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(imageUpload)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Enviar el comprobante (QR) o el TxID (USDT) de un pedido propio' })
  async submit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitPaymentProofDto,
    @UploadedFile() file: UploadedImage | undefined,
    @GetUser('id') userId: string,
  ) {
    return this.proofs.submit(id, userId, dto.method, dto.txId, file);
  }

  @Get('admin/:id/payment-proof/image')
  @Permissions(Permission.VIEW_ORDERS)
  @ApiOperation({ summary: '[ADMIN] Imagen del comprobante de pago' })
  async image(@Param('id', ParseUUIDPipe) id: string, @GetUser() actor: AuthUser, @Res() res: Response) {
    sendImage(res, await this.proofs.getImage(id, actor), 'private, no-store');
  }

  @Post('admin/:id/payment-proof/approve')
  @HttpCode(HttpStatus.OK)
  @Permissions(Permission.VIEW_ORDERS)
  @ApiOperation({ summary: '[ADMIN] Aprobar el pago manual (el pedido pasa a PROCESANDO)' })
  async approve(@Param('id', ParseUUIDPipe) id: string, @GetUser() actor: AuthUser) {
    return this.proofs.approve(id, actor);
  }

  @Post('admin/:id/payment-proof/reject')
  @HttpCode(HttpStatus.OK)
  @Permissions(Permission.VIEW_ORDERS)
  @ApiOperation({ summary: '[ADMIN] Rechazar el pago manual (cancela el pedido y repone el stock)' })
  async reject(@Param('id', ParseUUIDPipe) id: string, @GetUser() actor: AuthUser) {
    return this.proofs.reject(id, actor);
  }
}
