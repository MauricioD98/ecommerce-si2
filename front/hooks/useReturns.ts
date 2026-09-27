import { useCallback, useEffect, useState } from "react";
import { ReturnsService } from "@/service/api/returns.service";
import { getApiErrorMessage } from "@/service/api/error.utils";
import { ProcessReturnPayload, ReturnableOrder, ReturnRecord } from "@/types/returns.types";

// Buscador de la venta original del punto de devolución. La búsqueda es explícita (no on-type): el
// cajero escribe el código del ticket y confirma, así no se dispara una consulta por cada tecla.
export function useOrderSearch(branchId: string | null) {
    const [results, setResults] = useState<ReturnableOrder[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasSearched, setHasSearched] = useState(false);

    const search = useCallback(
        async (query: string) => {
            const term = query.trim();
            if (!term) return;

            setIsSearching(true);
            setError(null);
            try {
                setResults(await ReturnsService.searchOrder(term, branchId ?? undefined));
            } catch (error) {
                setResults([]);
                setError(getApiErrorMessage(error, "No se pudo buscar la venta."));
            } finally {
                setIsSearching(false);
                setHasSearched(true);
            }
        },
        [branchId],
    );

    const reset = useCallback(() => {
        setResults([]);
        setError(null);
        setHasSearched(false);
    }, []);

    return { results, isSearching, error, hasSearched, search, reset };
}

// Historial de devoluciones para auditoría. Con productId trae solo las de esa prenda.
export function useReturnHistory(params: { productId?: string; branchId?: string | null; enabled?: boolean }) {
    const { productId, branchId, enabled = true } = params;
    const [returns, setReturns] = useState<ReturnRecord[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [refreshIndex, setRefreshIndex] = useState(0);

    useEffect(() => {
        if (!enabled) return;
        let active = true;
        setIsLoading(true);

        ReturnsService.getHistory({
            ...(productId ? { productId } : {}),
            ...(branchId ? { branchId } : {}),
            limit: 50,
        })
            .then((response) => {
                if (!active) return;
                setReturns(response.data);
                setError(null);
            })
            .catch((error) => {
                if (active) setError(getApiErrorMessage(error, "No se pudo cargar el historial de devoluciones."));
            })
            .finally(() => {
                if (active) setIsLoading(false);
            });

        return () => {
            active = false;
        };
    }, [productId, branchId, enabled, refreshIndex]);

    const refetch = useCallback(() => setRefreshIndex((n) => n + 1), []);

    return { returns, isLoading, error, refetch };
}

// Envío de la devolución. Deja el error en manos de la vista para mostrarlo junto al botón.
export function useProcessReturn() {
    const [isProcessing, setIsProcessing] = useState(false);

    const process = useCallback(async (payload: ProcessReturnPayload): Promise<ReturnRecord> => {
        setIsProcessing(true);
        try {
            return await ReturnsService.process(payload);
        } finally {
            setIsProcessing(false);
        }
    }, []);

    return { process, isProcessing };
}
