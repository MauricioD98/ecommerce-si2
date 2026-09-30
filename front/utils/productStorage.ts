import { Product } from "@/types/product.types";

const PRODUCTS_CACHE_KEY = "sf_cached_products";

// Guarda una lista de productos en el almacenamiento local para disponibilidad offline
export function saveCatalogProducts(products: Product[]): void {
    if (typeof window === "undefined" || !products || products.length === 0) return;
    try {
        const existing = getAllCachedProducts();
        const map = new Map<string, Product>();
        for (const p of existing) {
            if (p?.id) map.set(p.id, p);
        }
        for (const p of products) {
            if (p?.id) map.set(p.id, p);
        }
        const merged = Array.from(map.values());
        localStorage.setItem(PRODUCTS_CACHE_KEY, JSON.stringify(merged));
    } catch {
        // best-effort: si excede cuota o modo privado, no bloquea
    }
}

// Guarda o actualiza un producto individual (con su detalle completo)
export function saveCachedProduct(product: Product): void {
    if (typeof window === "undefined" || !product || !product.id) return;
    try {
        const existing = getAllCachedProducts();
        const index = existing.findIndex((p) => p.id === product.id);
        if (index >= 0) {
            existing[index] = { ...existing[index], ...product };
        } else {
            existing.push(product);
        }
        localStorage.setItem(PRODUCTS_CACHE_KEY, JSON.stringify(existing));
    } catch {
        // best-effort
    }
}

// Obtiene todos los productos guardados localmente
export function getAllCachedProducts(): Product[] {
    if (typeof window === "undefined") return [];
    try {
        const raw = localStorage.getItem(PRODUCTS_CACHE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

// Obtiene un producto por su ID desde la caché local
export function getCachedProductById(id: string): Product | null {
    if (typeof window === "undefined" || !id) return null;
    try {
        const all = getAllCachedProducts();
        return all.find((p) => p.id === id) ?? null;
    } catch {
        return null;
    }
}
