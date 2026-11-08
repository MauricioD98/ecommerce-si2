import { apiClient } from "./axios.config";
import { SegmentationResponse, SegmentationSource } from "@/types/customerSegmentation.types";

// La tienda la decide el backend (JWT + tenant del request); el front solo elige real/demo
export class CustomerSegmentationService {
    private static readonly ENDPOINT = "/reports/segments";

    static async get(source: SegmentationSource): Promise<SegmentationResponse> {
        const response = await apiClient.get<SegmentationResponse>(this.ENDPOINT, { params: { source } });
        return response.data;
    }

    static async train(source: SegmentationSource): Promise<void> {
        await apiClient.post(`${this.ENDPOINT}/train`, { source });
    }

    static async deleteDemo(): Promise<void> {
        await apiClient.delete(`${this.ENDPOINT}/demo`);
    }
}
