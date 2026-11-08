import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { PosService } from "@/service/api/pos.service";
import { CategoryService } from "@/service/api/category.service";
import { getApiErrorMessage } from "@/service/api/error.utils";
import { Product } from "@/types/product.types";
import { CategoryOption } from "@/types/admin.types";

// category: id de la categoría elegida en los filtros del POS ("" = todas)
export function usePosCatalog(branchId: string | null, search: string, category = "") {
    const t = useTranslations("AdminErrors");
    const [products, setProducts] = useState<Product[]>([]);
    const [loadedKey, setLoadedKey] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const [refreshIndex, setRefreshIndex] = useState(0);
    const key = `${branchId ?? ""}:${search}:${category}`;

    useEffect(() => {
        if (!branchId) return;

        let active = true;

        PosService.getCatalog({ branchId, search: search || undefined, category: category || undefined, limit: 24, page: 1 })
            .then((response) => {
                if (!active) return;
                setProducts(response.data);
                setError(null);
            })
            .catch((error) => {
                if (active) setError(getApiErrorMessage(error, t("products")));
            })
            .finally(() => {
                if (active) setLoadedKey(key);
            });

        return () => {
            active = false;
        };

    }, [branchId, search, category, refreshIndex]);
    const refetch = useCallback(() => setRefreshIndex((n) => n + 1), []);

    return {
        products: branchId ? products : [],
        isLoading: !!branchId && loadedKey !== key,
        error,
        refetch
    };
}

// Categorías de la tienda para los filtros del POS (pocas: se piden una vez)
export function usePosCategories() {
    const [categories, setCategories] = useState<CategoryOption[]>([]);

    useEffect(() => {
        let active = true;
        CategoryService.getCategories().then((list) => {
            if (active) setCategories(list);
        });
        return () => {
            active = false;
        };
    }, []);

    return categories;
}
