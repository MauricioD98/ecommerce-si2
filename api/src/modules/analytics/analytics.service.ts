import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { i18nMessage } from '../../i18n/i18n-message';
import type { AuthUser } from '../../common/decorators/interfaces/request-with-user.interface';
import type { ReportQueryDto } from '../reports/dto/report-query.dto';
import { PAID_STATUSES, fillMissingDays, resolveReportBranchId, resolveReportRange, round2 } from '../reports/report-scope';
import { DashboardWidgetDto, GRID_COLS, WIDGET_METRICS } from './dto/analytics.dto';

const TOP_PRODUCTS = 5;

type Widget = Pick<DashboardWidgetDto, 'i' | 'x' | 'y' | 'w' | 'h' | 'type' | 'metric'>;

// Lienzo de quien todavía no guardó el suyo: KPIs arriba, ingresos y top productos al medio, pedidos abajo
export const DEFAULT_WIDGETS: Widget[] = [
  { i: 'kpi-revenue', x: 0, y: 0, w: 4, h: 2, type: 'KPI', metric: 'totalRevenue' },
  { i: 'kpi-orders', x: 4, y: 0, w: 4, h: 2, type: 'KPI', metric: 'totalOrders' },
  { i: 'kpi-ticket', x: 8, y: 0, w: 4, h: 2, type: 'KPI', metric: 'averageTicket' },
  { i: 'sales-chart', x: 0, y: 2, w: 8, h: 5, type: 'LINE_CHART', metric: 'dailyRevenue' },
  { i: 'top-products', x: 8, y: 2, w: 4, h: 5, type: 'DONUT_CHART', metric: 'topProducts' },
  { i: 'orders-chart', x: 0, y: 7, w: 12, h: 4, type: 'BAR_CHART', metric: 'dailyOrders' },
];

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------------------------
  // Lienzo (un diseño por usuario)
  // ---------------------------------------------------------------------------------------------

  async getLayout(userId: string): Promise<{ widgets: Widget[]; isDefault: boolean; updatedAt: Date | null }> {
    const row = await this.prisma.dashboardLayout.findUnique({ where: { userId } });
    const saved = Array.isArray(row?.widgetsConfig) ? (row.widgetsConfig as unknown as Widget[]) : null;
    // Sin diseño guardado (o uno vacío) se muestra el predeterminado, sin escribirlo en la base
    if (!saved || saved.length === 0) return { widgets: DEFAULT_WIDGETS, isDefault: true, updatedAt: null };
    return { widgets: saved, isDefault: false, updatedAt: row!.updatedAt };
  }

  async saveLayout(userId: string, widgets: DashboardWidgetDto[]) {
    const ids = new Set<string>();
    for (const widget of widgets) {
      const allowed: readonly string[] = WIDGET_METRICS[widget.metric];
      // ids repetidos, widgets que se salen de la grilla o un gráfico que no sirve para esa métrica
      if (ids.has(widget.i) || widget.x + widget.w > GRID_COLS || !allowed.includes(widget.type)) {
        throw new BadRequestException(i18nMessage('errors.INVALID_DASHBOARD_WIDGET', { id: widget.i }));
      }
      ids.add(widget.i);
    }

    // Solo los campos conocidos: la whitelist del ValidationPipe ya los filtró, pero esto es lo que se guarda
    const config = widgets.map(({ i, x, y, w, h, type, metric }) => ({ i, x, y, w, h, type, metric }));
    const row = await this.prisma.dashboardLayout.upsert({
      where: { userId },
      create: { userId, widgetsConfig: config },
      update: { widgetsConfig: config },
    });
    return { widgets: config, isDefault: false, updatedAt: row.updatedAt };
  }

  // ---------------------------------------------------------------------------------------------
  // Métricas (agregaciones de Prisma). Mismo alcance y rango que los reportes.
  // ---------------------------------------------------------------------------------------------

  async getMetrics(actor: AuthUser, query: ReportQueryDto) {
    const branchId = resolveReportBranchId(actor, query.branchId);
    const { from, to } = resolveReportRange(query);

    const inRange: Prisma.OrderWhereInput = {
      createdAt: { gte: from, lte: to },
      ...(branchId ? { branchId } : {}),
    };
    const paid: Prisma.OrderWhereInput = { ...inRange, status: { in: PAID_STATUSES } };

    const [byCreatedAt, paidTotals, totalOrders, topRows] = await Promise.all([
      // Ingresos por instante de creación; se agrupan por día (UTC) abajo, igual que los reportes
      this.prisma.order.groupBy({
        by: ['createdAt'],
        where: paid,
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
      this.prisma.order.aggregate({ where: paid, _sum: { totalAmount: true }, _count: { _all: true } }),
      // Todos los pedidos del rango, pagados o no (el panel muestra cuántos entraron)
      this.prisma.order.count({ where: inRange }),
      this.prisma.orderItem.groupBy({
        by: ['productId'],
        where: { order: paid },
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: TOP_PRODUCTS,
      }),
    ]);

    const daily = new Map<string, { date: string; revenue: number; orders: number }>();
    for (const row of byCreatedAt) {
      const date = row.createdAt.toISOString().slice(0, 10);
      const day = daily.get(date) ?? { date, revenue: 0, orders: 0 };
      day.revenue += Number(row._sum.totalAmount ?? 0);
      day.orders += row._count._all;
      daily.set(date, day);
    }

    const products = await this.prisma.product.findMany({
      where: { id: { in: topRows.map((row) => row.productId) } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(products.map((product) => [product.id, product.name]));

    const revenue = Number(paidTotals._sum.totalAmount ?? 0);
    const paidOrders = paidTotals._count._all;

    return {
      branchId: branchId ?? null,
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      totals: {
        revenue: round2(revenue),
        paidOrders,
        totalOrders,
        averageTicket: paidOrders > 0 ? round2(revenue / paidOrders) : 0,
      },
      dailyRevenue: fillMissingDays([...daily.values()], from, to),
      topProducts: topRows.map((row) => ({
        productId: row.productId,
        name: nameOf.get(row.productId) ?? row.productId,
        units: row._sum.quantity ?? 0,
      })),
    };
  }
}
