import { apiClient } from "./axios.config";
import {
    PaginatedReturns,
    ProcessReturnPayload,
    ReturnableOrder,
    ReturnRecord,
} from "@/types/returns.types";

export const ReturnsService = {
    // Busca la venta original por código de ticket, ID, NIT, razón social o datos del cliente.
    // El backend ya limita el alcance a la sucursal del usuario si no tiene ALL_BRANCHES.
    searchOrder: async (query: string, branchId?: string): Promise<ReturnableOrder[]> => {
        const response = await apiClient.get<ReturnableOrder[]>("/returns/search-order", {
            params: { query, ...(branchId ? { branchId } : {}) },
        });
        return response.data;
    },

    process: async (payload: ProcessReturnPayload): Promise<ReturnRecord> => {
        const response = await apiClient.post<ReturnRecord>("/returns/process", payload);
        return response.data;
    },

    // Historial de devoluciones. Con productId, solo las que incluyen esa prenda (auditoría de mermas).
    getHistory: async (params?: {
        productId?: string;
        branchId?: string;
        page?: number;
        limit?: number;
    }): Promise<PaginatedReturns> => {
        const response = await apiClient.get<PaginatedReturns>("/returns", { params });
        return response.data;
    },
};
