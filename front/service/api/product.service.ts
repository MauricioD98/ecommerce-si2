import { Product, ProductsResponse, ProductQueryParams, PaginationMeta } from "@/types/product.types";
import { apiClient } from "./axios.config";
import { ProductDiscountPayload, ProductPayload } from "@/types/admin.types";

// La interfaz debe ir por fuera de la clase
export interface ProductCart {
    productId: string;
    quantity: string; // Si necesitas hacer cálculos numéricos luego, te sugiero cambiar esto a 'number'
    product?: Product;
}

export const PLACEHOLDER_IMAGE = "https://upload.wikimedia.org/wikipedia/commons/a/a3/Image-not-found.png";

// Forma real que devuelve el backend: `sizes` (lista de tallas) e `imageUrl` puede venir null
export type RawProduct = Partial<Product> & { imageUrl?: string | null };

// Adapta el producto del backend a lo que espera la interfaz (imagen siempre presente, `sizes` como lista)
export const normalizeProduct = (raw: RawProduct): Product => ({
    ...raw,
    // Con sucursal seleccionada, `stock` pasa a ser el stock de esa sucursal
    stock: raw.branchStock ?? raw.stock ?? 0,
    effectivePrice: raw.effectivePrice ?? raw.price,
    imageUrl: raw.imageUrl?.trim() || PLACEHOLDER_IMAGE,
    sizes: raw.sizes ?? [],
    colors: raw.colors ?? [],
    collections: raw.collections ?? [],
    orderCount: raw.orderCount ?? 0,
} as Product);

const EMPTY_PAGINATION: PaginationMeta = { total: 0, page: 1, limit: 10, totalPages: 1 };

export class ProductService {
    private static readonly ENDPOINT = "/products";

    static filter(arg0: (product: any) => boolean) {
        throw new Error('Method not implemented.');
    }

    static async getProducts(
        params?: ProductQueryParams
    ): Promise<ProductsResponse> {
        // El backend responde { data, meta }; la interfaz usa `pagination`
        const response = await apiClient.get<{
            data?: RawProduct[];
            meta?: PaginationMeta;
            pagination?: PaginationMeta;
        }>(this.ENDPOINT, { params });

        return {
            data: (response.data.data ?? []).map(normalizeProduct),
            pagination: response.data.meta ?? response.data.pagination ?? EMPTY_PAGINATION,
        };
    }

    // Panel admin: recorre todas las páginas del catálogo (incluye productos inactivos).
    // Con branchId, el backend ya filtra por exclusividad de sucursal (globales + los exclusivos de
    // esa sucursal) y trae el stock/descuento de esa sucursal en cada producto.
    static async getAllProducts(branchId?: string | null): Promise<Product[]> {
        const limit = 100;
        const all: Product[] = [];
        let page = 1;
        let totalPages = 1;

        do {
            const response = await this.getProducts({ page, limit, branchId: branchId || undefined });
            all.push(...response.data);
            totalPages = response.pagination.totalPages;
            page += 1;
        } while (page <= totalPages);

        return all;
    }

    // Catálogo global (permiso MANAGE_PRODUCTS: Super Admin y Admin Sucursal)
    static async createProduct(data: ProductPayload): Promise<Product> {
        const response = await apiClient.post<RawProduct>(this.ENDPOINT, data);
        return normalizeProduct(response.data);
    }

    static async updateProduct(id: string, data: Partial<ProductPayload>): Promise<Product> {
        const response = await apiClient.patch<RawProduct>(`${this.ENDPOINT}/${id}`, data);
        return normalizeProduct(response.data);
    }

    static async deleteProduct(id: string): Promise<void> {
        await apiClient.delete(`${this.ENDPOINT}/${id}`);
    }

    // Solo SUPERADMIN: aplica el descuento a este producto en todas las sucursales
    static async applyDiscountToAllBranches(
        id: string,
        data: ProductDiscountPayload
    ): Promise<{ updatedBranches: number }> {
        const response = await apiClient.put<{ updatedBranches: number }>(
            `${this.ENDPOINT}/${id}/discounts/bulk`,
            data
        );
        return response.data;
    }

    static async getProductById(id: string, branchId?: string | null): Promise<Product> {
        const response = await apiClient.get<RawProduct>(`${this.ENDPOINT}/${id}`, {
            params: branchId ? { branchId } : undefined,
        });
        return normalizeProduct(response.data);
    }
}
