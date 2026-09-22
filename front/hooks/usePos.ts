import { useEffect, useState } from "react";
import { PosService } from "@/service/api/pos.service";
import { getApiErrorMessage } from "@/service/api/error.utils";
import { Product } from "@/types/product.types";

// Catálogo de productos con stock en la sucursal de la caja (el backend ya filtra por stock > 0
// y resuelve la sucursal del cajero autenticado), para el grid del POS
export function usePosCatalog(branchId: string | null, search: string) {
    const [products, setProducts] = useState<Product[]>([]);
    const [loadedKey, setLoadedKey] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branchId, search]);

    return { products: branchId ? products : [], isLoading: !!branchId && loadedKey !== key, error };
}
