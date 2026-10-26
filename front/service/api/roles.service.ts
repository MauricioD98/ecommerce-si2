import { apiClient } from "./axios.config";
import { RoleItem, RolePayload } from "@/types/admin.types";

// Un permiso del catálogo de la plataforma y si el usuario actual puede otorgarlo
export interface PermissionCatalogItem {
    permission: string;
    grantable: boolean;
}

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

    // Catálogo definido por la plataforma (GET /roles/permissions): la tienda no lo puede ampliar
    static async getPermissionCatalog(): Promise<PermissionCatalogItem[]> {
        const response = await apiClient.get<PermissionCatalogItem[]>(`${this.ENDPOINT}/permissions`);
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
