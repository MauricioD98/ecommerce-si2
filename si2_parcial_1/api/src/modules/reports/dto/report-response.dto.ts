import { ApiProperty } from '@nestjs/swagger';

export class SalesByDayDto {
  @ApiProperty({ example: '2026-09-20' })
  date: string;

  @ApiProperty({ example: 350.5 })
  revenue: number;

  @ApiProperty({ example: 4 })
  orders: number;
}

export class SalesOverviewDto {
  @ApiProperty({ nullable: true, description: 'Sucursal del reporte (null = todas)' })
  branchId: string | null;

  @ApiProperty({ example: '2026-08-22' })
  from: string;

  @ApiProperty({ example: '2026-09-20' })
  to: string;

  @ApiProperty({ description: 'Ingresos de pedidos pagados (PROCESANDO, ENVIADO, ENTREGADO)' })
  totalRevenue: number;

  @ApiProperty({ description: 'Todos los pedidos del rango' })
  totalOrders: number;

  @ApiProperty({ description: 'Pedidos pagados' })
  paidOrders: number;

  @ApiProperty({ description: 'Pedidos ENTREGADO' })
  completedOrders: number;

  @ApiProperty()
  pendingOrders: number;

  @ApiProperty()
  cancelledOrders: number;

  @ApiProperty({ description: 'Ingreso promedio por pedido pagado' })
  averageOrderValue: number;

  @ApiProperty({ description: 'Descuentos de trabajador aplicados en pedidos pagados' })
  totalDiscounts: number;

  @ApiProperty({ type: [SalesByDayDto], description: 'Ventas diarias del rango (incluye días en cero)' })
  salesByDay: SalesByDayDto[];
}

export class TopProductDto {
  @ApiProperty()
  productId: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  sku: string;

  @ApiProperty({ description: 'Unidades vendidas' })
  units: number;

  @ApiProperty({ description: 'Ingresos generados' })
  revenue: number;
}

export class DynamicReportResultDto {
  @ApiProperty({ description: 'SQL que generó la IA y se ejecutó' })
  sql: string;

  @ApiProperty({ type: [String] })
  columns: string[];

  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } })
  rows: Record<string, unknown>[];

  @ApiProperty()
  rowCount: number;
}
