import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, Matches, Max, Min, ValidateNested } from 'class-validator';

// Tipo de gráfico de cada widget del lienzo
export const WIDGET_TYPES = ['LINE_CHART', 'BAR_CHART', 'DONUT_CHART', 'KPI'] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

// Qué dato muestra el widget, y con qué gráficos se puede dibujar (una serie diaria no entra en una dona)
export const WIDGET_METRICS = {
  dailyRevenue: ['LINE_CHART', 'BAR_CHART'],
  dailyOrders: ['LINE_CHART', 'BAR_CHART'],
  topProducts: ['DONUT_CHART', 'BAR_CHART'],
  totalRevenue: ['KPI'],
  totalOrders: ['KPI'],
  averageTicket: ['KPI'],
} as const satisfies Record<string, readonly WidgetType[]>;
export type WidgetMetric = keyof typeof WIDGET_METRICS;

// Grilla de 12 columnas (la misma que usa react-grid-layout en el front)
export const GRID_COLS = 12;
export const MAX_WIDGETS = 24;

export class DashboardWidgetDto {
  @ApiProperty({ example: 'sales-chart', description: 'Id único del widget en el lienzo' })
  @Matches(/^[a-z0-9-]{1,40}$/)
  i: string;

  @ApiProperty({ example: 0, minimum: 0, maximum: GRID_COLS - 1 })
  @IsInt()
  @Min(0)
  @Max(GRID_COLS - 1)
  x: number;

  @ApiProperty({ example: 0, minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(500)
  y: number;

  @ApiProperty({ example: 6, minimum: 1, maximum: GRID_COLS })
  @IsInt()
  @Min(1)
  @Max(GRID_COLS)
  w: number;

  @ApiProperty({ example: 4, minimum: 1, maximum: 12 })
  @IsInt()
  @Min(1)
  @Max(12)
  h: number;

  @ApiProperty({ enum: WIDGET_TYPES, example: 'LINE_CHART' })
  @IsIn(WIDGET_TYPES)
  type: WidgetType;

  @ApiProperty({ enum: Object.keys(WIDGET_METRICS), example: 'dailyRevenue' })
  @IsIn(Object.keys(WIDGET_METRICS))
  metric: WidgetMetric;
}

export class SaveDashboardLayoutDto {
  @ApiProperty({ type: [DashboardWidgetDto] })
  @IsArray()
  @ArrayMaxSize(MAX_WIDGETS)
  @ValidateNested({ each: true })
  @Type(() => DashboardWidgetDto)
  widgets: DashboardWidgetDto[];
}
