import { useEffect, useState } from "react";
import { ReportsService } from "@/service/api/reports.service";
import { getApiErrorMessage } from "@/service/api/error.utils";
import { DynamicReportResult, SalesOverview, TopProduct } from "@/types/admin.types";

const DAY_MS = 24 * 60 * 60 * 1000;

// Métricas de los últimos `days` días. branchId '' = todas (el backend fuerza la sucursal propia si corresponde)
export function useSalesReport(branchId: string, days: number) {
    const [overview, setOverview] = useState<SalesOverview | null>(null);
    const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
    const [loadedKey, setLoadedKey] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const key = `${branchId}|${days}`;

    useEffect(() => {
        let active = true;
        const params = {
            ...(branchId ? { branchId } : {}),
            from: new Date(Date.now() - (days - 1) * DAY_MS).toISOString().slice(0, 10),
        };

        Promise.all([ReportsService.getSalesOverview(params), ReportsService.getTopProducts({ ...params, limit: 5 })])
            .then(([overviewData, topData]) => {
                if (!active) return;
                setOverview(overviewData);
                setTopProducts(topData);
                setError(null);
            })
            .catch((error) => {
                if (active) setError(getApiErrorMessage(error, "No se pudieron cargar las métricas."));
            })
            .finally(() => {
                if (active) setLoadedKey(key);
            });

        return () => {
            active = false;
        };
    }, [branchId, days, key]);

    return { overview, topProducts, error, isLoading: loadedKey !== key };
}

export interface DynamicReportEntry {
    id: number;
    prompt: string;
    result?: DynamicReportResult;
    error?: string;
}

// "Pregúntale a la IA": conserva las últimas preguntas (la más reciente primero)
export function useDynamicReport() {
    const [entries, setEntries] = useState<DynamicReportEntry[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const ask = async (prompt: string) => {
        setIsLoading(true);
        const id = Date.now();
        try {
            const result = await ReportsService.runDynamicReport(prompt);
            setEntries((prev) => [{ id, prompt, result }, ...prev].slice(0, 5));
        } catch (error) {
            setEntries((prev) => [{ id, prompt, error: getApiErrorMessage(error, "No se pudo generar el reporte.") }, ...prev].slice(0, 5));
        } finally {
            setIsLoading(false);
        }
    };

    return { entries, isLoading, ask };
}
