import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { ReportQueryDto, TopProductsQueryDto } from './dto/report-query.dto';
import { DynamicReportDto } from './dto/dynamic-report.dto';
import { DynamicReportResultDto, SalesOverviewDto, TopProductDto } from './dto/report-response.dto';
import { JwtAuthGuard } from '../../common/decorators/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/decorators/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/constants/permissions';
import { GetUser } from '../../common/decorators/get-user.decorator';
import type { AuthUser } from '../../common/decorators/interfaces/request-with-user.interface';

// Todos los endpoints exigen VIEW_REPORTS. Sin el permiso ALL_BRANCHES los datos se limitan a la sucursal propia
@ApiTags('reports')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions(Permission.VIEW_REPORTS)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('sales-overview')
  @ApiOperation({ summary: 'Sales summary: revenue, orders by status and daily sales' })
  @ApiResponse({ status: 200, type: SalesOverviewDto })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async salesOverview(@GetUser() user: AuthUser, @Query() query: ReportQueryDto): Promise<SalesOverviewDto> {
    return await this.reportsService.getSalesOverview(user, query);
  }

  @Get('top-products')
  @ApiOperation({ summary: 'Best-selling products (units and revenue)' })
  @ApiResponse({ status: 200, type: [TopProductDto] })
  async topProducts(@GetUser() user: AuthUser, @Query() query: TopProductsQueryDto): Promise<TopProductDto[]> {
    return await this.reportsService.getTopProducts(user, query);
  }

  @Post('dynamic')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Dynamic report from a natural-language question (Gemini Text-to-SQL)',
    description:
      'La IA genera un SELECT que se valida y se ejecuta con un rol de solo lectura sobre vistas del esquema "reporting", ' +
      'que ya aplican el filtro de sucursal del usuario.',
  })
  @ApiBody({ type: DynamicReportDto })
  @ApiResponse({ status: 200, type: DynamicReportResultDto })
  @ApiResponse({ status: 400, description: 'The generated query could not be executed' })
  @ApiResponse({ status: 403, description: 'The generated query is not allowed' })
  @ApiResponse({ status: 503, description: 'AI not configured or unavailable' })
  async dynamic(@GetUser() user: AuthUser, @Body() dto: DynamicReportDto): Promise<DynamicReportResultDto> {
    return await this.reportsService.runDynamicReport(user, dto.prompt);
  }
}
