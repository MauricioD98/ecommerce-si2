import { apiClient } from "./axios.config";
import { DynamicReportResult, SalesOverview, TopProduct } from "@/types/admin.types";

interface ReportParams {
    branchId?: string;
    from?: string;
    to?: string;
}

export class ReportsService {
    private static readonly ENDPOINT = "/reports";

    // Sin branchId: todas las sucursales (alcance global) o la sucursal propia (lo decide el backend)
    static async getSalesOverview(params?: ReportParams): Promise<SalesOverview> {
        const response = await apiClient.get<SalesOverview>(`${this.ENDPOINT}/sales-overview`, { params });
        return response.data;
    }

    static async getTopProducts(params?: ReportParams & { limit?: number }): Promise<TopProduct[]> {
        const response = await apiClient.get<TopProduct[]>(`${this.ENDPOINT}/top-products`, { params });
        return response.data;
    }

    // Puede tardar unos segundos: la IA genera el SQL y luego se ejecuta
    static async runDynamicReport(prompt: string): Promise<DynamicReportResult> {
        const response = await apiClient.post<DynamicReportResult>(
            `${this.ENDPOINT}/dynamic`,
            { prompt },
            { timeout: 60000 }
        );
        return response.data;
    }
}
