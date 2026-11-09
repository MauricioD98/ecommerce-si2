import { useEffect, useState } from "react";
import axios from "axios";
import { ReportsService } from "@/service/api/reports.service";
import { getApiErrorMessage } from "@/service/api/error.utils";
import { useTranslations } from "next-intl";
import { DynamicReportResult, SalesOverview, TopProduct } from "@/types/admin.types";

const DAY_MS = 24 * 60 * 60 * 1000;

// Métricas de los últimos `days` días. branchId '' = todas (el backend fuerza la sucursal propia si corresponde)
export function useSalesReport(branchId: string, days: number) {
    const [overview, setOverview] = useState<SalesOverview | null>(null);
    const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
    const [loadedKey, setLoadedKey] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const t = useTranslations("Reports");

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
                if (active) setError(getApiErrorMessage(error, t("loadFailed")));
            })
            .finally(() => {
                if (active) setLoadedKey(key);
            });

        return () => {
            active = false;
        };
        // t cambia solo con el idioma: no hace falta recargar por eso
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branchId, days, key]);

    return { overview, topProducts, error, isLoading: loadedKey !== key };
}

// Tipo de error de un reporte con IA: se decide por el `code` de la API, no por el status HTTP (un 403
// del validador es una consulta rechazada, no falta de permiso)
export type DynamicReportErrorKind = "rejected" | "failed" | "forbidden" | "unavailable";

export interface DynamicReportEntry {
    id: number;
    prompt: string;
    result?: DynamicReportResult;
    error?: string;
    errorKind?: DynamicReportErrorKind;
}

function errorKindOf(error: unknown): DynamicReportErrorKind {
    if (!axios.isAxiosError(error) || !error.response) return "unavailable";
    const code = (error.response.data as { code?: string } | undefined)?.code;
    if (code === "REPORT_QUERY_REJECTED") return "rejected";
    if (code === "REPORT_QUERY_FAILED") return "failed";
    if (code === "REPORT_BRANCH_UNKNOWN") return "forbidden";
    if (code === "REPORT_UNAVAILABLE" || code === "REPORT_AI_UNAVAILABLE" || code === "REPORT_AI_RATE_LIMITED") return "unavailable";
    // Sin código propio: los guards (permiso VIEW_REPORTS, plan) responden 401/403
    if (error.response.status === 401 || error.response.status === 403) return "forbidden";
    return error.response.status >= 500 ? "unavailable" : "failed";
}

// "Pregúntale a la IA": conserva las últimas preguntas (la más reciente primero)
export function useDynamicReport() {
    const [entries, setEntries] = useState<DynamicReportEntry[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const t = useTranslations("Reports.dynamic");

    const ask = async (prompt: string) => {
        setIsLoading(true);
        const id = Date.now();
        try {
            const result = await ReportsService.runDynamicReport(prompt);
            setEntries((prev) => [{ id, prompt, result }, ...prev].slice(0, 5));
        } catch (error) {
            setEntries((prev) =>
                [{ id, prompt, error: getApiErrorMessage(error, t("failed")), errorKind: errorKindOf(error) }, ...prev].slice(0, 5)
            );
        } finally {
            setIsLoading(false);
        }
    };

    return { entries, isLoading, ask };
}
