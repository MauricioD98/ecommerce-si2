import { Branch } from "@/types/branch.types";
import { BranchPayload } from "@/types/admin.types";
import { apiClient } from "./axios.config";

export class BranchService {
    private static readonly ENDPOINT = "/branches";

    // Sucursales activas (endpoint público)
    static async getActiveBranches(): Promise<Branch[]> {
        const response = await apiClient.get<Branch[]>(this.ENDPOINT);
        return response.data;
    }

    // Panel admin: todas las sucursales, incluidas las inactivas (ADMIN_SUCURSAL solo recibe la suya)
    static async getAllBranches(): Promise<Branch[]> {
        const response = await apiClient.get<Branch[]>(`${this.ENDPOINT}/manage/all`);
        return response.data;
    }

    static async createBranch(data: BranchPayload): Promise<Branch> {
        const response = await apiClient.post<Branch>(this.ENDPOINT, data);
        return response.data;
    }

    static async updateBranch(id: string, data: Partial<BranchPayload>): Promise<Branch> {
        const response = await apiClient.patch<Branch>(`${this.ENDPOINT}/${id}`, data);
        return response.data;
    }

    static async deleteBranch(id: string): Promise<void> {
        await apiClient.delete(`${this.ENDPOINT}/${id}`);
    }
}
