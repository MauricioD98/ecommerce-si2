import { apiClient } from "./axios.config";
import { ForecastResponse, ForecastSource } from "@/types/salesForecast.types";

// La tienda la decide el backend (JWT + tenant del request); el front solo elige real/demo
export class SalesForecastService {
    private static readonly ENDPOINT = "/reports/forecast";

    static async get(source: ForecastSource): Promise<ForecastResponse> {
        const response = await apiClient.get<ForecastResponse>(this.ENDPOINT, { params: { source } });
        return response.data;
    }

    static async train(source: ForecastSource): Promise<void> {
        await apiClient.post(`${this.ENDPOINT}/train`, { source });
    }

    static async deleteDemo(): Promise<void> {
        await apiClient.delete(`${this.ENDPOINT}/demo`);
    }
}
