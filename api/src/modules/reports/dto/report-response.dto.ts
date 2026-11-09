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

export class DynamicReportEntityDto {
  @ApiProperty({ enum: ['sucursal', 'producto', 'categoria'] })
  tipo: string;

  @ApiProperty({ description: 'Palabras del usuario', example: 'set deportivo' })
  texto: string;

  @ApiProperty({ description: 'Nombre real al que se resolvió', example: 'Set Deportivo' })
  nombre: string;

  @ApiProperty({ enum: ['exacto', 'parcial', 'aproximado'] })
  metodo: string;
}

export class DynamicReportInterpretationDto {
  @ApiProperty({ example: 'America/La_Paz', description: 'Zona horaria con la que se interpretaron las fechas' })
  zonaHoraria: string;

  @ApiProperty({ example: '2026-11-09 21:30', description: 'Fecha y hora local de la tienda al consultar' })
  fechaHoraLocal: string;

  @ApiProperty({ example: 'BOB', description: 'Moneda de todos los importes' })
  moneda: string;

  @ApiProperty({ type: [DynamicReportEntityDto] })
  entidades: DynamicReportEntityDto[];

  @ApiProperty({ type: [String], description: 'Avisos sobre la interpretación (nombres aproximados, monedas de cobro)' })
  avisos: string[];
}

export class DynamicReportClarificationOptionDto {
  @ApiProperty({ enum: ['sucursal', 'producto', 'categoria'] })
  tipo: string;

  @ApiProperty()
  texto: string;

  @ApiProperty({ type: [String], description: 'Opciones entre las que elegir (vacío si no se encontró ninguna)' })
  opciones: string[];
}

export class DynamicReportClarificationDto {
  @ApiProperty({ example: 'Encontré varios productos que coinciden con «blusa»: Blusa Lino, Blusa Seda. ¿A cuál te refieres?' })
  mensaje: string;

  @ApiProperty({ type: [DynamicReportClarificationOptionDto] })
  opciones: DynamicReportClarificationOptionDto[];
}

// Resultado de una pregunta que NO es un error (los errores van con su status HTTP y un `code`):
//   ok             -> hay datos (un 0 calculado también es un dato)
//   sin_datos      -> la consulta se ejecutó y no devolvió filas, o todas sus celdas son NULL
//   aclaracion     -> un nombre es ambiguo o no existe: NO se ejecutó la consulta
//   sin_permiso    -> el usuario nombró una sucursal fuera de su alcance: NO se ejecutó la consulta
//   no_respondible -> la IA indicó que la pregunta no se puede responder con los datos disponibles
export type DynamicReportStatus = 'ok' | 'sin_datos' | 'aclaracion' | 'sin_permiso' | 'no_respondible';

export class DynamicReportResultDto {
  @ApiProperty({ enum: ['ok', 'sin_datos', 'aclaracion', 'sin_permiso', 'no_respondible'] })
  estado: DynamicReportStatus;

  @ApiProperty({ description: 'SQL que generó la IA y se ejecutó' })
  sql: string;

  @ApiProperty({ type: [String] })
  columns: string[];

  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } })
  rows: Record<string, unknown>[];

  @ApiProperty()
  rowCount: number;

  @ApiProperty({ type: DynamicReportInterpretationDto, required: false })
  interpretation?: DynamicReportInterpretationDto;

  @ApiProperty({
    type: DynamicReportClarificationDto,
    required: false,
    description: 'Presente cuando un nombre es ambiguo o no existe en el ámbito del usuario: la consulta NO se ejecutó',
  })
  clarification?: DynamicReportClarificationDto;
}
