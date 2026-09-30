import { useCallback, useEffect, useState } from "react";
import { InventoryService } from "@/service/api/inventory.service";
import { ProductService } from "@/service/api/product.service";
import { getApiErrorMessage } from "@/service/api/error.utils";
import { Product } from "@/types/product.types";
import { InventoryItem, InventorySizeStock, ProductDiscountPayload, SetInventoryPayload } from "@/types/admin.types";
import {
    addOfflineInventoryUpdate,
    cacheBranchInventory,
    cacheBranchProducts,
    getCachedBranchInventory,
    getCachedBranchProducts,
} from "@/utils/offlineInventoryQueue";

export interface InventoryRow {
    product: Product;
    // Suma del stock vendible de todas las tallas
    stock: number;
    // Suma de las mermas (devoluciones en mal estado): existen en la tienda pero no se pueden vender
    damagedStock: number;
    // Stock por talla (una fila por cada talla que tiene el producto, 0 si no tiene registro todavía)
    sizes: InventorySizeStock[];
    // Descuento del producto en la sucursal (vive en su registro de inventario)
    discountPrice: number | null;
    discountPercentage: number | null;
}

// Catálogo + stock y descuentos de una sucursal con soporte offline y caché local
export function useInventory(branchId: string | null) {
    const [products, setProducts] = useState<Product[]>([]);
    const [productsLoadedFor, setProductsLoadedFor] = useState<string | null>(null);
    const [inventoryMap, setInventoryMap] = useState<Record<string, InventoryItem>>({});
    const [loadedBranchId, setLoadedBranchId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const loadProducts = useCallback(async (bId: string, active: () => boolean) => {
        try {
            const data = await ProductService.getAllProducts(bId);
            if (!active()) return;
            setProducts(data);
            cacheBranchProducts(bId, data);
        } catch (err) {
            const cached = getCachedBranchProducts(bId);
            if (cached && cached.length > 0 && active()) {
                setProducts(cached);
            } else if (active()) {
                setError(getApiErrorMessage(err, "No se pudieron cargar los productos."));
            }
        } finally {
            if (active()) setProductsLoadedFor(bId);
        }
    }, []);

    const loadInventory = useCallback(async (bId: string, active: () => boolean) => {
        try {
            const items = await InventoryService.getBranchInventory(bId);
            if (!active()) return;
            setInventoryMap(Object.fromEntries(items.map((item) => [item.productId, item])));
            cacheBranchInventory(bId, items);
            setError(null);
        } catch (err) {
            const cached = getCachedBranchInventory(bId);
            if (cached && active()) {
                setInventoryMap(Object.fromEntries(cached.map((item) => [item.productId, item])));
                setError(null);
            } else if (active()) {
                setError(getApiErrorMessage(err, "No se pudo cargar el inventario de la sucursal."));
            }
        } finally {
            if (active()) setLoadedBranchId(bId);
        }
    }, []);

    useEffect(() => {
        if (!branchId) return;
        let isActive = true;
        loadProducts(branchId, () => isActive);
        return () => {
            isActive = false;
        };
    }, [branchId, loadProducts]);

    useEffect(() => {
        if (!branchId) return;
        let isActive = true;
        loadInventory(branchId, () => isActive);

        const handleSynced = () => {
            if (branchId) loadInventory(branchId, () => isActive);
        };
        window.addEventListener("inventory-synced", handleSynced);

        return () => {
            isActive = false;
            window.removeEventListener("inventory-synced", handleSynced);
        };
    }, [branchId, loadInventory]);

    const isLoading = !!branchId && (productsLoadedFor !== branchId || loadedBranchId !== branchId);

    const rows: InventoryRow[] = products.map((product) => {
        const inventory = branchId ? inventoryMap[product.id] : undefined;
        const sizes: InventorySizeStock[] = product.sizes.map((size) => {
            const row = inventory?.sizes.find((s) => s.size === size);
            return { size, stock: row?.stock ?? 0, damagedStock: row?.damagedStock ?? 0 };
        });
        return {
            product,
            stock: inventory?.stock ?? 0,
            damagedStock: inventory?.damagedStock ?? 0,
            sizes,
            discountPrice: inventory?.discountPrice ?? null,
            discountPercentage: inventory?.discountPercentage ?? null,
        };
    });

    // Guarda el inventario con soporte offline y persistencia inmediata en la UI
    const saveInventory = async (productId: string, payload: SetInventoryPayload, productName?: string) => {
        if (!branchId) return { isOffline: false };

        const isOnline = typeof navigator !== "undefined" && navigator.onLine;

        const applyOptimistic = () => {
            const existing = inventoryMap[productId];
            const prod = products.find((p) => p.id === productId);
            const basePrice = prod ? Number(prod.price) : (existing?.price ?? 0);
            const discountPrice = payload.discountPrice ?? null;
            const discountPercentage = payload.discountPercentage ?? null;

            let effectivePrice = basePrice;
            if (discountPrice !== null && discountPrice < effectivePrice) {
                effectivePrice = discountPrice;
            } else if (discountPercentage !== null && discountPercentage > 0) {
                effectivePrice = Math.round(basePrice * (1 - discountPercentage / 100) * 100) / 100;
            }

            const optimisticItem: InventoryItem = {
                productId,
                branchId,
                productName: prod?.name ?? existing?.productName ?? productName ?? '',
                sku: prod?.sku ?? existing?.sku ?? '',
                price: basePrice,
                effectivePrice,
                stock: payload.sizes.reduce((sum, s) => sum + s.stock, 0),
                damagedStock: existing?.damagedStock ?? 0,
                sizes: payload.sizes.map((s) => ({
                    size: s.size,
                    stock: s.stock,
                    damagedStock: existing?.sizes?.find((x) => x.size === s.size)?.damagedStock ?? 0,
                })),
                discountPrice,
                discountPercentage,
            };

            setInventoryMap((prev) => {
                const next = { ...prev, [productId]: optimisticItem };
                cacheBranchInventory(branchId, Object.values(next));
                return next;
            });
        };

        if (!isOnline) {
            await addOfflineInventoryUpdate(branchId, productId, payload, productName);
            applyOptimistic();
            return { isOffline: true };
        }

        try {
            const updated = await InventoryService.saveInventory(branchId, productId, payload);
            setInventoryMap((prev) => {
                const next = { ...prev, [productId]: updated };
                cacheBranchInventory(branchId, Object.values(next));
                return next;
            });
            return { isOffline: false };
        } catch {
            // Si la llamada de red falló (sin conexión real), guardar en cola local y actualizar UI
            await addOfflineInventoryUpdate(branchId, productId, payload, productName);
            applyOptimistic();
            return { isOffline: true };
        }
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
