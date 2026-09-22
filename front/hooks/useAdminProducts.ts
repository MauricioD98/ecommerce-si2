import { useCallback, useEffect, useState } from "react";
import { ProductService } from "@/service/api/product.service";
import { CategoryService } from "@/service/api/category.service";
import { getApiErrorMessage } from "@/service/api/error.utils";
import { CategoryOption, ProductPayload } from "@/types/admin.types";
import { PaginationMeta, Product } from "@/types/product.types";

const PAGE_SIZE = 10;

// Catálogo global paginado (incluye productos inactivos) con búsqueda por nombre.
// Con branchId, cada producto trae además su stock específico en esa sucursal (product.stock pasa
// a ser el de esa sucursal en vez del global legado; ver normalizeProduct en product.service.ts).
export function useAdminProducts(page: number, search: string, branchId?: string | null) {
    const [products, setProducts] = useState<Product[]>([]);
    const [meta, setMeta] = useState<PaginationMeta>({ total: 0, page: 1, limit: PAGE_SIZE, totalPages: 1 });
    const [refreshKey, setRefreshKey] = useState(0);
    const [loadedKey, setLoadedKey] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const key = `${page}|${search}|${branchId ?? ''}|${refreshKey}`;

    useEffect(() => {
        let active = true;

        ProductService.getProducts({ page, limit: PAGE_SIZE, search: search || undefined, branchId: branchId || undefined })
            .then((response) => {
                if (!active) return;
                setProducts(response.data);
                setMeta(response.pagination);
                setError(null);
            })
            .catch((error) => {
                if (active) setError(getApiErrorMessage(error, "No se pudieron cargar los productos."));
            })
            .finally(() => {
                if (active) setLoadedKey(key);
            });

        return () => {
            active = false;
        };
    }, [page, search, branchId, key]);

    const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);

    // Las acciones lanzan el error para que el formulario o la fila lo muestren
    const createProduct = async (data: ProductPayload) => {
        await ProductService.createProduct(data);
        refresh();
    };

    const updateProduct = async (id: string, data: Partial<ProductPayload>) => {
        await ProductService.updateProduct(id, data);
        refresh();
    };

    const deleteProduct = async (id: string) => {
        await ProductService.deleteProduct(id);
        refresh();
    };

    return { products, meta, error, isLoading: loadedKey !== key, createProduct, updateProduct, deleteProduct };
}

// Categorías para el selector del formulario
export function useCategoryOptions() {
    const [categories, setCategories] = useState<CategoryOption[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let active = true;

        CategoryService.getCategories()
            .then((data) => {
                if (active) setCategories(data);
            })
            .catch(() => {
                if (active) setCategories([]);
            })
            .finally(() => {
                if (active) setIsLoading(false);
            });

        return () => {
            active = false;
        };
    }, []);

    return { categories, isLoading };
}
