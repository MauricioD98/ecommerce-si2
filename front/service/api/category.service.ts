import { apiClient } from "./axios.config";
import { CategoryOption, CategoryPayload, PaginatedCategories } from "@/types/admin.types";

export class CategoryService {
    // El backend pagina; el catálogo tiene pocas categorías, por eso se pide un límite alto
    static async getCategories(): Promise<CategoryOption[]> {
        const response = await apiClient.get<{ data: CategoryOption[] }>("/categories", { params: { limit: 100 } });
        return response.data.data;
    }

    // Panel admin: listado paginado con búsqueda, para la tabla de gestión de categorías
    static async getCategoriesAdmin(page = 1, limit = 10, search?: string): Promise<PaginatedCategories> {
        const response = await apiClient.get<PaginatedCategories>("/categories", {
            params: { page, limit, search: search || undefined },
        });
        return response.data;
    }

    static async createCategory(data: CategoryPayload) {
        const response = await apiClient.post("/categories", data);
        return response.data;
    }

    static async updateCategory(id: string, data: Partial<CategoryPayload>) {
        const response = await apiClient.patch(`/categories/${id}`, data);
        return response.data;
    }

    // El backend rechaza el borrado si la categoría todavía tiene productos asociados
    static async deleteCategory(id: string): Promise<void> {
        await apiClient.delete(`/categories/${id}`);
    }
}
