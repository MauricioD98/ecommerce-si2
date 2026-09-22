import { useCallback, useEffect, useState } from "react";
import { CategoryService } from "@/service/api/category.service";
import { getApiErrorMessage } from "@/service/api/error.utils";
import { Category, CategoryPayload } from "@/types/admin.types";

const PAGE_SIZE = 10;

// Categorías paginadas (incluye inactivas) con búsqueda por nombre/descripción, para el panel admin
export function useAdminCategories(page: number, search: string) {
    const [categories, setCategories] = useState<Category[]>([]);
    const [total, setTotal] = useState(0);
    const [refreshKey, setRefreshKey] = useState(0);
    const [loadedKey, setLoadedKey] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const key = `${page}|${search}|${refreshKey}`;

    useEffect(() => {
        let active = true;

        CategoryService.getCategoriesAdmin(page, PAGE_SIZE, search)
            .then((response) => {
                if (!active) return;
                setCategories(response.data);
                setTotal(response.meta.total);
                setError(null);
            })
            .catch((error) => {
                if (active) setError(getApiErrorMessage(error, "No se pudieron cargar las categorías."));
            })
            .finally(() => {
                if (active) setLoadedKey(key);
            });

        return () => {
            active = false;
        };
    }, [page, search, key]);

    const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);

    // Las acciones lanzan el error para que el formulario o la fila lo muestren
    const createCategory = async (data: CategoryPayload) => {
        await CategoryService.createCategory(data);
        refresh();
    };

    const updateCategory = async (id: string, data: Partial<CategoryPayload>) => {
        await CategoryService.updateCategory(id, data);
        refresh();
    };

    const deleteCategory = async (id: string) => {
        await CategoryService.deleteCategory(id);
        refresh();
    };

    return {
        categories,
        total,
        totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
        isLoading: loadedKey !== key,
        error,
        createCategory,
        updateCategory,
        deleteCategory,
    };
}
