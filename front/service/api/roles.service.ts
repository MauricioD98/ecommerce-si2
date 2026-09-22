import { apiClient } from "./axios.config";
import { RoleItem, RolePayload } from "@/types/admin.types";

export class RolesService {
    private static readonly ENDPOINT = "/roles";

    // Requiere el permiso MANAGE_ROLES
    static async getRoles(): Promise<RoleItem[]> {
        const response = await apiClient.get<RoleItem[]>(this.ENDPOINT);
        return response.data;
    }

    // Roles que el usuario actual puede asignar a un empleado (nunca más permisos de los propios)
    static async getAssignableRoles(): Promise<RoleItem[]> {
        const response = await apiClient.get<RoleItem[]>(`${this.ENDPOINT}/assignable`);
        return response.data;
    }

    static async createRole(data: RolePayload): Promise<RoleItem> {
        const response = await apiClient.post<RoleItem>(this.ENDPOINT, data);
        return response.data;
    }

    static async updateRole(id: string, data: Partial<RolePayload>): Promise<RoleItem> {
        const response = await apiClient.patch<RoleItem>(`${this.ENDPOINT}/${id}`, data);
        return response.data;
    }

    static async deleteRole(id: string): Promise<void> {
        await apiClient.delete(`${this.ENDPOINT}/${id}`);
    }
}
