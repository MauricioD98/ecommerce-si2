import { useCallback, useEffect, useState } from "react";
import { PosService } from "@/service/api/pos.service";
import { getApiErrorMessage } from "@/service/api/error.utils";
import { Product } from "@/types/product.types";

export function usePosCatalog(branchId: string | null, search: string) {
    const [products, setProducts] = useState<Product[]>([]);
    const [loadedKey, setLoadedKey] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const [refreshIndex, setRefreshIndex] = useState(0);
    const key = `${branchId ?? ""}:${search}`;

    useEffect(() => {
        if (!branchId) return;

        let active = true;

        PosService.getCatalog({ branchId, search: search || undefined, limit: 24, page: 1 })
            .then((response) => {
                if (!active) return;
                setProducts(response.data);
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

    }, [branchId, search, refreshIndex]);
    const refetch = useCallback(() => setRefreshIndex((n) => n + 1), []);

    return {
        products: branchId ? products : [],
        isLoading: !!branchId && loadedKey !== key,
        error,
        refetch
    };
}