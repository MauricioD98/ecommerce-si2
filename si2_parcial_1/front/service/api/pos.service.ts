import { apiClient } from "./axios.config";
import { PosCheckoutPayload, PosCheckoutResponse } from "@/types/pos.types";
import { ProductsResponse, PaginationMeta } from "@/types/product.types";
import { normalizeProduct, RawProduct } from "./product.service";

export const PosService = {
    checkout: async (payload: PosCheckoutPayload): Promise<PosCheckoutResponse> => {
        const response = await apiClient.post<PosCheckoutResponse>("/pos/checkout", payload);
        return response.data;
    },

    // Catálogo del POS: el backend resuelve la sucursal del cajero y ya filtra solo lo que tiene stock
    getCatalog: async (params: { branchId?: string; search?: string; page?: number; limit?: number }): Promise<ProductsResponse> => {
        const response = await apiClient.get<{ data?: RawProduct[]; meta?: PaginationMeta }>("/pos/products", { params });
        return {
            data: (response.data.data ?? []).map(normalizeProduct),
            pagination: response.data.meta ?? { total: 0, page: 1, limit: 24, totalPages: 1 },
        };
    },
};
