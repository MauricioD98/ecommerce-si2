import { useEffect, useState } from "react";
import { InventoryService } from "@/service/api/inventory.service";
import { ProductService } from "@/service/api/product.service";
import { getApiErrorMessage } from "@/service/api/error.utils";
import { Product } from "@/types/product.types";
import { InventoryItem, ProductDiscountPayload, SetInventoryPayload } from "@/types/admin.types";

export interface InventoryRow {
    product: Product;
    stock: number;
    // Descuento del producto en la sucursal (vive en su registro de inventario)
    discountPrice: number | null;
    discountPercentage: number | null;
}

// Catálogo + stock y descuentos de una sucursal. Los productos sin registro en la sucursal aparecen
// con stock 0 y sin descuento, porque el endpoint de inventario solo devuelve los que ya tienen fila.
//
// El catálogo en sí (qué productos aparecen) se pide con branchId: el backend ya filtra por
// exclusividad de sucursal (globales + los exclusivos de esta), así que acá no hace falta filtrar
// nada aparte — antes se pedía con getAllProducts() sin branchId, así que siempre traía TODO el
// catálogo del sistema sin importar la sucursal elegida.
export function useInventory(branchId: string | null) {
    const [products, setProducts] = useState<Product[]>([]);
    const [productsLoadedFor, setProductsLoadedFor] = useState<string | null>(null);
    const [inventoryMap, setInventoryMap] = useState<Record<string, InventoryItem>>({});
    const [loadedBranchId, setLoadedBranchId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!branchId) return;
        let active = true;

        ProductService.getAllProducts(branchId)
            .then((data) => {
                if (active) setProducts(data);
            })
            .catch((error) => {
                if (active) setError(getApiErrorMessage(error, "No se pudieron cargar los productos."));
            })
            .finally(() => {
                if (active) setProductsLoadedFor(branchId);
            });

        return () => {
            active = false;
        };
    }, [branchId]);

    useEffect(() => {
        if (!branchId) return;
        let active = true;

        InventoryService.getBranchInventory(branchId)
            .then((items) => {
                if (!active) return;
                setInventoryMap(Object.fromEntries(items.map((item) => [item.productId, item])));
                setError(null);
            })
            .catch((error) => {
                if (active) setError(getApiErrorMessage(error, "No se pudo cargar el inventario de la sucursal."));
            })
            .finally(() => {
                if (active) setLoadedBranchId(branchId);
            });

        return () => {
            active = false;
        };
    }, [branchId]);

    const isLoading = !!branchId && (productsLoadedFor !== branchId || loadedBranchId !== branchId);

    const rows: InventoryRow[] = products.map((product) => {
        const inventory = branchId ? inventoryMap[product.id] : undefined;
        return {
            product,
            stock: inventory?.stock ?? 0,
            discountPrice: inventory?.discountPrice ?? null,
            discountPercentage: inventory?.discountPercentage ?? null,
        };
    });

    // Las acciones lanzan el error para que la fila lo muestre
    const saveInventory = async (productId: string, payload: SetInventoryPayload) => {
        if (!branchId) return;
        const updated = await InventoryService.saveInventory(branchId, productId, payload);
        setInventoryMap((prev) => ({ ...prev, [productId]: updated }));
    };

    // Solo SUPERADMIN: el descuento se copia a todas las sucursales; se recarga la sucursal visible
    const applyDiscountToAllBranches = async (productId: string, discount: ProductDiscountPayload) => {
        await ProductService.applyDiscountToAllBranches(productId, discount);
        if (!branchId) return;
        const items = await InventoryService.getBranchInventory(branchId);
        setInventoryMap(Object.fromEntries(items.map((item) => [item.productId, item])));
    };

    return { rows, isLoading, error, saveInventory, applyDiscountToAllBranches };
}
