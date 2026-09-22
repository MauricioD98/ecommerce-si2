import { apiClient } from "./axios.config";
import { InventoryItem, SetInventoryPayload } from "@/types/admin.types";

export class InventoryService {
    // Inventario de una sucursal (solo productos que ya tienen registro en esa sucursal)
    static async getBranchInventory(branchId: string): Promise<InventoryItem[]> {
        const response = await apiClient.get<InventoryItem[]>(`/branches/${branchId}/inventory`);
        return response.data;
    }

    // Fija el stock absoluto y el descuento de un producto en la sucursal (ADMIN_SUCURSAL solo en la suya)
    static async saveInventory(
        branchId: string,
        productId: string,
        payload: SetInventoryPayload
    ): Promise<InventoryItem> {
        const response = await apiClient.put<InventoryItem>(
            `/branches/${branchId}/inventory/${productId}`,
            payload
        );
        return response.data;
    }
}
