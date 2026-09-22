import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/decorators/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/decorators/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/constants/permissions';
import { GetUser } from '../../common/decorators/get-user.decorator';
import type { AuthUser } from '../../common/decorators/interfaces/request-with-user.interface';
import { PosService } from './pos.service';
import { PosCheckoutDto } from './dto/pos-checkout.dto';
import { PosCheckoutResponseDto } from './dto/pos-receipt.dto';

@ApiTags('pos')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pos')
export class PosController {
  constructor(private readonly posService: PosService) {}

  @Get('products')
  @Permissions(Permission.USE_POS)
  @ApiOperation({
    summary: 'Catálogo del POS: productos con stock > 0 en la sucursal del cajero autenticado',
    description:
      'La sucursal se toma del cajero logueado (@GetUser). Solo quien tiene ALL_BRANCHES puede pasar ' +
      '`branchId` para operar la caja de otra sucursal.',
  })
  @ApiQuery({ name: 'branchId', required: false, description: 'Solo tiene efecto con permiso ALL_BRANCHES' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Productos con stock disponible en la sucursal' })
  async getCatalog(
    @Query('branchId') branchId: string | undefined,
    @Query('search') search: string | undefined,
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
    @GetUser() cashier: AuthUser,
  ) {
    return await this.posService.getCatalog(cashier, {
      branchId,
      search,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post('checkout')
  @Permissions(Permission.USE_POS)
  @ApiOperation({
    summary: 'Cobrar una venta física en caja (CASH o PHYSICAL_CARD)',
    description:
      'Calcula el total desde la BD, descuenta el inventario de la sucursal del cajero y crea la orden ya ' +
      'como ENTREGADO/COMPLETADO. No usa Stripe ni envía correos.',
  })
  @ApiBody({ type: PosCheckoutDto })
  @ApiResponse({ status: 201, description: 'Venta registrada', type: PosCheckoutResponseDto })
  @ApiResponse({ status: 400, description: 'Stock insuficiente o datos inválidos' })
  @ApiResponse({ status: 403, description: 'El rol no tiene el permiso USE_POS' })
  async checkout(@Body() dto: PosCheckoutDto, @GetUser() cashier: AuthUser): Promise<PosCheckoutResponseDto> {
    return await this.posService.checkout(cashier, dto);
  }
}
