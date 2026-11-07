import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/decorators/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/decorators/guards/permissions.guard';
import { AnyPermission } from '../../common/decorators/permissions.decorator';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Permission } from '../../common/constants/permissions';
import type { AuthUser } from '../../common/decorators/interfaces/request-with-user.interface';
import { OfflineChangeDto } from './dto/offline-change.dto';
import { OfflineSyncService } from './offline-sync.service';

// Cambios del panel de administración hechos sin conexión en la PWA (uno por petición, en orden)
@ApiTags('admin-offline-sync')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/offline-sync')
export class OfflineSyncController {
  constructor(private readonly service: OfflineSyncService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  // Cada entidad exige además su propio permiso (ver OfflineSyncService)
  @AnyPermission(Permission.MANAGE_PRODUCTS, Permission.VIEW_ORDERS)
  @ApiOperation({ summary: 'Apply one admin change made offline, only if the data still matches what the device read' })
  @ApiResponse({ status: 200, description: 'Applied, or already applied with this changeId' })
  @ApiResponse({ status: 409, description: 'OFFLINE_CONFLICT: the data changed on the server; body.current has it' })
  async apply(@GetUser() actor: AuthUser, @Body() dto: OfflineChangeDto) {
    return this.service.apply(actor, dto);
  }
}
