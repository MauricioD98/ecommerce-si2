import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/decorators/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/decorators/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/constants/permissions';
import { GetUser } from '../../common/decorators/get-user.decorator';
import type { AuthUser } from '../../common/decorators/interfaces/request-with-user.interface';
import { ReportQueryDto } from '../reports/dto/report-query.dto';
import { AnalyticsService } from './analytics.service';
import { SaveDashboardLayoutDto } from './dto/analytics.dto';

// Dashboard interactivo del panel (/admin/reports/dashboard). Mismo permiso que Reportes; el diseño
// del lienzo es de cada usuario y las métricas respetan su alcance de sucursal.
@ApiTags('analytics')
@ApiBearerAuth('JWT-auth')
@Controller('analytics')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions(Permission.VIEW_REPORTS)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('layout')
  @ApiOperation({ summary: 'Diseño del lienzo del usuario (el predeterminado si no guardó ninguno)' })
  async getLayout(@GetUser('id') userId: string) {
    return { success: true, data: await this.analytics.getLayout(userId), message: 'OK' };
  }

  @Put('layout')
  @ApiOperation({ summary: 'Guardar posición, tamaño, gráfico y métrica de cada widget' })
  async saveLayout(@GetUser('id') userId: string, @Body() dto: SaveDashboardLayoutDto) {
    return { success: true, data: await this.analytics.saveLayout(userId, dto.widgets), message: 'Diseño guardado' };
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Ingresos diarios, top 5 productos y total de pedidos del rango' })
  async metrics(@GetUser() user: AuthUser, @Query() query: ReportQueryDto) {
    return { success: true, data: await this.analytics.getMetrics(user, query), message: 'OK' };
  }
}
