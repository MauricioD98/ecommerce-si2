import { apiClient } from "./axios.config";
import { CreateStaffPayload, StaffUser, UpdateStaffPayload } from "@/types/admin.types";

export class StaffService {
    private static readonly ENDPOINT = "/users/staff";

    // SUPERADMIN ve todo el personal; ADMIN_SUCURSAL solo el de su sucursal (lo filtra el backend)
    static async getStaff(): Promise<StaffUser[]> {
        const response = await apiClient.get<StaffUser[]>(this.ENDPOINT);
        return response.data;
    }

    static async createStaff(data: CreateStaffPayload): Promise<StaffUser> {
        const response = await apiClient.post<StaffUser>(this.ENDPOINT, data);
        return response.data;
    }

    static async updateStaff(id: string, data: UpdateStaffPayload): Promise<StaffUser> {
        const response = await apiClient.patch<StaffUser>(`${this.ENDPOINT}/${id}`, data);
        return response.data;
    }
}
