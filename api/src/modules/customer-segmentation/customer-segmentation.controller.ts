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
import { SegmentationSourceDto } from './dto/segmentation.dto';
import { CustomerSegmentationService } from './customer-segmentation.service';

// Segmentación de clientes RFM + K-Means (aprendizaje no supervisado, IA/ANS). Resultados AGREGADOS de toda
// la tienda: consultar, entrenar y borrar la demo exigen VIEW_REPORTS + alcance global (ALL_BRANCHES).
// La tienda sale SIEMPRE del tenant del request; ningún parámetro del navegador elige carpeta ni tienda.
@ApiTags('reports')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, PermissionsGuard, PlanFeatureGuard)
@Permissions(Permission.VIEW_REPORTS)
@RequirePlanFeature('aiReports')
@Controller('reports/segments')
export class CustomerSegmentationController {
  constructor(private readonly segmentation: CustomerSegmentationService) {}

  @Get()
  @ApiOperation({ summary: 'Estado y grupos de clientes de la tienda (no entrena)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403, description: 'Requiere alcance sobre todas las sucursales' })
  async get(@GetUser() user: AuthUser, @Query() query: SegmentationSourceDto) {
    return await this.segmentation.getSegments(user, query.source);
  }

  @Post('train')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Inicia el entrenamiento de la segmentación de la tienda' })
  @ApiResponse({ status: 202 })
  @ApiResponse({ status: 409, description: 'Ya hay un entrenamiento en curso para esta tienda' })
  async train(@GetUser() user: AuthUser, @Body() dto: SegmentationSourceDto) {
    return await this.segmentation.startTraining(user, dto.source);
  }

  @Delete('demo')
  @ApiOperation({ summary: 'Elimina la demo SIMULADA de esta tienda (no toca datos reales)' })
  async deleteDemo(@GetUser() user: AuthUser) {
    return await this.segmentation.deleteDemo(user);
  }
}
