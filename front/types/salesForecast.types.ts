// GET /reports/forecast — pronóstico semanal de ventas (IA/AS, aprendizaje supervisado)
export type ForecastSource = 'real' | 'demo';
export type ForecastStatus = 'sin_entrenar' | 'entrenando' | 'listo' | 'datos_insuficientes' | 'error';
export type ForecastErrorCode = 'python_no_disponible' | 'interrumpido' | 'entrada_invalida' | 'fallo_entrenamiento';
export type ForecastMethod = 'modelo' | 'alternativa_promedio' | 'datos_insuficientes';

export interface ForecastRow {
    sucursal_id: string | null;
    sucursal_nombre: string | null;
    producto_id: string;
    producto_nombre: string;
    categoria: string;
    talla: string | null;
    semanas_historial: number;
    metodo: ForecastMethod;
    unidades_previstas: number | null;
    unidades_mostradas: number | null;
}

interface SplitPart {
    semanas: number;
    filas: number;
    desde: string;
    hasta: string;
}

export interface ForecastResult {
    estado: 'listo' | 'datos_insuficientes';
    origen: 'simulado' | 'real';
    version_modelo: string;
    entrenado_en: string;
    corte_datos: string;
    periodo_pronosticado: { desde: string; hasta: string };
    datos: { semanas_objetivo_elegibles: number; filas_elegibles: number; series: number };
    reglas: { min_semanas_objetivo: number; min_filas_entrenamiento: number };
    division?: {
        semanas_objetivo: number;
        entrenamiento: SplitPart;
        prueba: SplitPart;
        porcentaje_semanas_entrenamiento: number;
        porcentaje_filas_entrenamiento: number;
    };
    metricas_prueba?: {
        filas: number;
        mae_modelo: number;
        mae_linea_base_promedio_4_semanas: number;
        mae_linea_base_semana_anterior: number;
        supera_linea_base_principal: boolean;
    };
}

export interface ForecastResponse {
    source: ForecastSource;
    simulated: boolean;
    status: ForecastStatus;
    startedAt: string | null;
    finishedAt: string | null;
    errorCode: ForecastErrorCode | null;
    canTrain: boolean;
    branchId: string | null;
    result: ForecastResult | null;
    forecast: ForecastRow[];
}
