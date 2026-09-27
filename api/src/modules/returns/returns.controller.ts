import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/decorators/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/decorators/guards/permissions.guard';
import { AnyPermission, Permissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/constants/permissions';
import { GetUser } from '../../common/decorators/get-user.decorator';
import type { AuthUser } from '../../common/decorators/interfaces/request-with-user.interface';
import { ReturnsService } from './returns.service';
import { ProcessReturnDto } from './dto/process-return.dto';
import { QueryReturnsDto, SearchOrderDto } from './dto/query-returns.dto';
import {
  PaginatedReturnsDto,
  ReturnableOrderDto,
  ReturnResponseDto,
} from './dto/return-response.dto';

@ApiTags('returns')
@ApiBearerAuth('JWT-auth')
// Los permisos van por ruta, no a nivel de clase: procesar una devolución exige PROCESS_RETURNS, pero
// el historial es un reporte de inventario y también lo necesita quien administra el stock.
// (PermissionsGuard resuelve PERMISSIONS_KEY con getAllAndOverride: un @Permissions de clase ganaría
// sobre el @AnyPermission del método, así que no se pone ninguno de clase.)
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('returns')
export class ReturnsController {
  constructor(private readonly returnsService: ReturnsService) {}

  @Get('search-order')
  @Permissions(Permission.PROCESS_RETURNS)
  @ApiOperation({
    summary: 'Buscar la venta original para devolver (por ticket, ID, NIT, razón social o cliente)',
    description:
      'Solo devuelve ventas cobradas y no anuladas. Cada ítem trae cuánto se devolvió ya y cuánto queda ' +
      'por devolver. Sin el permiso ALL_BRANCHES la búsqueda se limita a las ventas de la sucursal propia ' +
      'más los pedidos web sin sucursal asignada.',
  })
  @ApiResponse({ status: 200, description: 'Ventas que coinciden con la búsqueda', type: [ReturnableOrderDto] })
  @ApiResponse({ status: 403, description: 'El rol no tiene el permiso PROCESS_RETURNS' })
  async searchOrder(
    @Query() query: SearchOrderDto,
    @GetUser() staff: AuthUser,
  ): Promise<ReturnableOrderDto[]> {
    return await this.returnsService.searchOrder(staff, query);
  }

  @Post('process')
  @Permissions(Permission.PROCESS_RETURNS)
  @ApiOperation({
    summary: 'Procesar una devolución física y reingresar la mercadería al inventario',
    description:
      'En una sola transacción: valida que no se devuelva más de lo vendido (contando devoluciones ' +
      'anteriores), registra la devolución con el reembolso calculado desde el precio histórico de la ' +
      'venta, y reingresa cada prenda según su estado: SELLABLE al stock vendible de la sucursal, ' +
      'DAMAGED a las mermas (damagedStock), que nunca vuelven al catálogo. Si con esto ya no queda nada ' +
      'por devolver, la venta pasa a REEMBOLSADO.',
  })
  @ApiBody({ type: ProcessReturnDto })
  @ApiResponse({ status: 201, description: 'Devolución registrada', type: ReturnResponseDto })
  @ApiResponse({ status: 400, description: 'Se intentó devolver más de lo vendido, o la venta no es reembolsable' })
  @ApiResponse({ status: 403, description: 'La venta pertenece a otra sucursal' })
  @ApiResponse({ status: 404, description: 'Venta no encontrada' })
  async process(@Body() dto: ProcessReturnDto, @GetUser() staff: AuthUser): Promise<ReturnResponseDto> {
    return await this.returnsService.process(staff, dto);
  }

  @Get()
  @AnyPermission(Permission.PROCESS_RETURNS, Permission.MANAGE_INVENTORY)
  @ApiOperation({
    summary: 'Historial de devoluciones (auditoría de mermas y reingresos)',
    description:
      'Con `productId` devuelve solo las devoluciones que incluyen esa prenda. Lo puede consultar tanto ' +
      'quien recibe devoluciones como quien administra el inventario.',
  })
  @ApiResponse({ status: 200, description: 'Devoluciones paginadas', type: PaginatedReturnsDto })
  async findAll(
    @Query() query: QueryReturnsDto,
    @GetUser() staff: AuthUser,
  ): Promise<PaginatedReturnsDto> {
    return await this.returnsService.findAll(staff, query);
  }

  @Get(':id')
  @AnyPermission(Permission.PROCESS_RETURNS, Permission.MANAGE_INVENTORY)
  @ApiOperation({ summary: 'Detalle de una devolución' })
  @ApiParam({ name: 'id', description: 'ID de la devolución' })
  @ApiResponse({ status: 200, description: 'Detalle de la devolución', type: ReturnResponseDto })
  @ApiResponse({ status: 404, description: 'Devolución no encontrada' })
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<ReturnResponseDto> {
    return await this.returnsService.findOne(id);
  }
}
