// Dashboard interactivo de analítica (espejo de api/src/modules/analytics)

export const WIDGET_TYPES = ["LINE_CHART", "BAR_CHART", "DONUT_CHART", "KPI"] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

// Qué dato muestra cada widget y con qué gráficos se puede dibujar (mismo mapa que WIDGET_METRICS en la API)
export const WIDGET_METRICS = {
    dailyRevenue: ["LINE_CHART", "BAR_CHART"],
    dailyOrders: ["LINE_CHART", "BAR_CHART"],
    topProducts: ["DONUT_CHART", "BAR_CHART"],
    totalRevenue: ["KPI"],
    totalOrders: ["KPI"],
    averageTicket: ["KPI"],
} as const satisfies Record<string, readonly WidgetType[]>;
export type WidgetMetric = keyof typeof WIDGET_METRICS;
export const WIDGET_METRIC_KEYS = Object.keys(WIDGET_METRICS) as WidgetMetric[];

export const GRID_COLS = 12;
export const MAX_WIDGETS = 24;

// Posición y tamaño en unidades de la grilla (lo que entiende react-grid-layout) + qué se dibuja
export interface DashboardWidget {
    i: string;
    x: number;
    y: number;
    w: number;
    h: number;
    type: WidgetType;
    metric: WidgetMetric;
}

export interface DashboardLayout {
    widgets: DashboardWidget[];
    // true: el usuario nunca guardó, es el diseño predeterminado
    isDefault: boolean;
    updatedAt: string | null;
}

export interface DailyPoint {
    date: string;
    revenue: number;
    orders: number;
}

export interface TopProductPoint {
    productId: string;
    name: string;
    units: number;
}

export interface AnalyticsMetrics {
    branchId: string | null;
    from: string;
    to: string;
    totals: {
        revenue: number;
        paidOrders: number;
        totalOrders: number;
        averageTicket: number;
    };
    dailyRevenue: DailyPoint[];
    topProducts: TopProductPoint[];
}

export interface AnalyticsRange {
    from: string;
    to: string;
    branchId?: string;
}
