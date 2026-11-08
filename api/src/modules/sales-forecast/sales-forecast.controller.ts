import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/decorators/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/decorators/guards/permissions.guard';
import { PlanFeatureGuard } from '../../common/decorators/guards/plan-feature.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequirePlanFeature } from '../../common/decorators/plan-feature.decorator';
import { Permission } from '../../common/constants/permissions';
import { GetUser } from '../../common/decorators/get-user.decorator';
import type { AuthUser } from '../../common/decorators/interfaces/request-with-user.interface';
import { ForecastQueryDto, ForecastSourceDto } from './dto/forecast.dto';
import { SalesForecastService } from './sales-forecast.service';

// Pronóstico semanal de ventas (aprendizaje supervisado, IA/AS). La tienda sale SIEMPRE del tenant del
// request (JWT atado a la tienda); ningún parámetro del navegador elige carpeta, modelo ni tienda.
@ApiTags('reports')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, PermissionsGuard, PlanFeatureGuard)
@Permissions(Permission.VIEW_REPORTS)
@RequirePlanFeature('aiReports')
@Controller('reports/forecast')
export class SalesForecastController {
  constructor(private readonly forecast: SalesForecastService) {}

  @Get()
  @ApiOperation({ summary: 'Estado y pronóstico de la próxima semana (no entrena)' })
  @ApiResponse({ status: 200 })
  async get(@GetUser() user: AuthUser, @Query() query: ForecastQueryDto) {
    return await this.forecast.getForecast(user, query.source, query.branchId);
  }

  @Post('train')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Inicia el entrenamiento de la tienda (requiere ALL_BRANCHES)' })
  @ApiResponse({ status: 202 })
  @ApiResponse({ status: 409, description: 'Ya hay un entrenamiento en curso para esta tienda' })
  async train(@GetUser() user: AuthUser, @Body() dto: ForecastSourceDto) {
    return await this.forecast.startTraining(user, dto.source);
  }

  @Delete('demo')
  @ApiOperation({ summary: 'Elimina la demo SIMULADA de esta tienda (no toca datos reales)' })
  async deleteDemo(@GetUser() user: AuthUser) {
    return await this.forecast.deleteDemo(user);
  }
}
