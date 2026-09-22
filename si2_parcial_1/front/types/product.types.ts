import { Category } from "./category.types";

// Descuento del producto en la sucursal seleccionada (el backend lo envía anidado y solo si pidió ?branchId)
export interface ProductDiscount {
    discountPrice: number | null;
    discountPercentage: number | null;
}

export interface Product {
    id: string;
    name: string;
    description: string;
    quantity: number;
    price: number;
    // Precio vigente en la sucursal seleccionada (sin sucursal es el precio base)
    effectivePrice?: number;
    discount?: ProductDiscount | null;
    // Stock mostrado: el de la sucursal seleccionada si existe, si no el global
    stock: number;
    branchStock?: number | null;
    sku: string;
    imageUrl: string;
    category: string;
    categoryId: string;
    sizes: string[];
    isActive?: boolean;
    // Sucursal a la que el producto es exclusivo (null = global, visible en todas)
    branchId?: string | null;
}

export interface ProductQueryParams {
    page?: number;
    limit?: number;
    search?: string;
    category?: string;
    branchId?: string;
}

export interface PaginationMeta {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export interface ProductsResponse {
    data: Product[];
    pagination: PaginationMeta
}

export interface ProductCart {
    productId: string;
    quantity: number;
}

