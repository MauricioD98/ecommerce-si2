import { apiClient } from "./axios.config";
import { AnalyticsMetrics, AnalyticsRange, DashboardLayout, DashboardWidget } from "@/types/analytics.types";

// Dashboard interactivo (/admin/reports/dashboard). Requiere VIEW_REPORTS; el diseño es de cada usuario
// y las métricas respetan su alcance de sucursal (lo decide el backend).
const ENDPOINT = "/analytics";

export const analyticsService = {
    getLayout: async (): Promise<DashboardLayout> => {
        const { data } = await apiClient.get<{ data: DashboardLayout }>(`${ENDPOINT}/layout`);
        return data.data;
    },

    saveLayout: async (widgets: DashboardWidget[]): Promise<DashboardLayout> => {
        const { data } = await apiClient.put<{ data: DashboardLayout }>(`${ENDPOINT}/layout`, { widgets });
        return data.data;
    },

    // Sin branchId: todas las sucursales (alcance global) o la sucursal propia
    getMetrics: async ({ from, to, branchId }: AnalyticsRange): Promise<AnalyticsMetrics> => {
        const { data } = await apiClient.get<{ data: AnalyticsMetrics }>(`${ENDPOINT}/metrics`, {
            params: { from, to, ...(branchId ? { branchId } : {}) },
        });
        return data.data;
    },
};
