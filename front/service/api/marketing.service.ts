import { apiClient } from "./axios.config";
import { CampaignPayload, CampaignResult } from "@/types/admin.types";

export class MarketingService {
    // Solo con el permiso SEND_MARKETING. Sin branchId: todos los usuarios (alcance global) o la sucursal propia
    static async sendCampaign(data: CampaignPayload): Promise<CampaignResult> {
        const response = await apiClient.post<CampaignResult>("/marketing/send-campaign", data);
        return response.data;
    }
}
