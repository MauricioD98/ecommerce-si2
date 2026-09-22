import { apiClient } from "./axios.config";
import { CollectionOption } from "@/types/collection.types";
import { Collection, CollectionPayload, PaginatedCollections } from "@/types/admin.types";

export class CollectionService {
    // Público (filtro de la tienda): solo colecciones activas
    static async getCollections(): Promise<CollectionOption[]> {
        const response = await apiClient.get<{ data: CollectionOption[] }>("/collections", {
            params: { isActive: true, limit: 100 },
        });
        return response.data.data;
    }

    // Panel admin (selector "Colecciones" del formulario de producto): todas, incluidas inactivas
    static async getCollectionOptions(): Promise<CollectionOption[]> {
        const response = await apiClient.get<{ data: CollectionOption[] }>("/collections", {
            params: { limit: 100 },
        });
        return response.data.data;
    }

    // Panel admin: listado paginado con búsqueda, incluye colecciones inactivas
    static async getCollectionsAdmin(page = 1, limit = 10, search?: string): Promise<PaginatedCollections> {
        const response = await apiClient.get<PaginatedCollections>("/collections", {
            params: { page, limit, search: search || undefined },
        });
        return response.data;
    }

    static async createCollection(data: CollectionPayload): Promise<Collection> {
        const response = await apiClient.post<Collection>("/collections", data);
        return response.data;
    }

    static async updateCollection(id: string, data: Partial<CollectionPayload>): Promise<Collection> {
        const response = await apiClient.patch<Collection>(`/collections/${id}`, data);
        return response.data;
    }

    // El backend rechaza el borrado si la colección todavía tiene productos asociados
    static async deleteCollection(id: string): Promise<void> {
        await apiClient.delete(`/collections/${id}`);
    }
}
