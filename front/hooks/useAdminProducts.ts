import { useCallback, useEffect, useState } from "react";
import { ProductService } from "@/service/api/product.service";
import { CategoryService } from "@/service/api/category.service";
import { CollectionService } from "@/service/api/collection.service";
import { getApiErrorMessage } from "@/service/api/error.utils";
import { CategoryOption, ProductPayload } from "@/types/admin.types";
import { PaginationMeta, Product } from "@/types/product.types";
import { CollectionOption } from "@/types/collection.types";

const PAGE_SIZE = 10;

// Catálogo global paginado con búsqueda por nombre.
// Con branchId, cada producto trae además su stock específico en esa sucursal (product.stock pasa
// a ser el de esa sucursal en vez del global legado; ver normalizeProduct en product.service.ts).
// `includeArchived` controla si la tabla muestra los productos archivados (isActive: false). Por
// defecto no: eliminar es un soft delete, así que sin este filtro la fila archivada seguiría en la
// lista y no se vería que "se eliminó".
export function useAdminProducts(
    page: number,
    search: string,
    branchId?: string | null,
    includeArchived = false,
) {
    const [products, setProducts] = useState<Product[]>([]);
    const [meta, setMeta] = useState<PaginationMeta>({ total: 0, page: 1, limit: PAGE_SIZE, totalPages: 1 });
    const [refreshKey, setRefreshKey] = useState(0);
    const [loadedKey, setLoadedKey] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const key = `${page}|${search}|${branchId ?? ''}|${includeArchived}|${refreshKey}`;

    useEffect(() => {
        let active = true;

        ProductService.getProducts({
            page,
            limit: PAGE_SIZE,
            search: search || undefined,
            branchId: branchId || undefined,
            // Explícito en los dos casos: la tabla muestra SOLO activos, o SOLO archivados. Nunca
            // mezclados, así "eliminar" saca la fila de la vista de verdad.
            isActive: !includeArchived,
        })
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
    }, [page, search, branchId, includeArchived, key]);

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

    // Archivar (soft delete). La fila sale del estado local en el acto, sin esperar el refetch: la
    // tabla muestra o solo activos o solo archivados, así que un producto recién archivado ya no
    // pertenece a la lista que se está viendo en ninguno de los dos casos. Después se revalida contra
    // el servidor para que el total y la paginación queden exactos.
    const deleteProduct = async (id: string) => {
        await ProductService.deleteProduct(id);

        setProducts((previous) => previous.filter((product) => product.id !== id));
        setMeta((previous) => ({ ...previous, total: Math.max(0, previous.total - 1) }));

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

// Colecciones (todas, incluidas inactivas) para el selector "Colecciones" del formulario de producto
export function useCollectionOptions() {
    const [collections, setCollections] = useState<CollectionOption[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let active = true;

        CollectionService.getCollectionOptions()
            .then((data) => {
                if (active) setCollections(data);
            })
            .catch(() => {
                if (active) setCollections([]);
            })
            .finally(() => {
                if (active) setIsLoading(false);
            });

        return () => {
            active = false;
        };
    }, []);

    return { collections, isLoading };
}
