// GET /reports/segments — segmentación de clientes RFM + K-Means (IA/ANS, aprendizaje no supervisado)
export type SegmentationSource = 'real' | 'demo';
export type SegmentationStatus = 'sin_entrenar' | 'entrenando' | 'listo' | 'datos_insuficientes' | 'error';
export type SegmentationErrorCode = 'python_no_disponible' | 'interrumpido' | 'entrada_invalida' | 'fallo_entrenamiento';
export type SegmentVariable = 'recencia_dias' | 'frecuencia' | 'monto';
export type SegmentComparison = 'menor' | 'similar' | 'mayor';
export type InsufficientCode = 'pocos_clientes' | 'poca_diversidad' | 'sin_k_valido';

export interface SegmentStats {
    mediana: number;
    p25: number;
    p75: number;
    promedio: number;
    min: number;
    max: number;
}

export interface CustomerSegment {
    grupo: number;
    clientes: number;
    clientes_entrenamiento: number;
    clientes_evaluacion: number;
    porcentaje: number;
    rfm: Record<SegmentVariable, SegmentStats>;
    comparacion_con_tienda: Record<SegmentVariable, SegmentComparison>;
    descripcion: string;
}

export interface SegmentMetrics {
    clientes: number;
    grupos_con_clientes: number;
    inercia_media: number;
    silhouette: number | null;
    davies_bouldin: number | null;
    motivo_no_disponible: string | null;
}

export interface SegmentWarning {
    codigo: 'corte_anterior_extraccion' | 'k_maximo' | 'separacion_debil' | 'evaluacion_un_grupo' | 'grupos_vacios';
    texto: string;
    k?: number;
    n?: number;
    umbral?: number;
}

export interface SegmentationResult {
    estado: 'listo' | 'datos_insuficientes';
    origen: 'simulado' | 'real';
    tienda_id: string;
    version_modelo: string;
    semilla: number;
    entrenado_en: string;
    corte: string;
    periodo: { desde: string; hasta_exclusivo: string; dias: number };
    zona_horaria: string;
    moneda: string;
    datos: {
        clientes: { total: number; elegibles: number; sin_compras_validas: number; sin_compras_en_periodo: number };
        pedidos: {
            filas_leidas: number;
            duplicados_exactos_descartados: number;
            excluidos: Record<string, number>;
            pendientes: number;
            cancelados: number;
            validos_en_periodo: number;
        };
        devoluciones: { pedidos_con_devolucion: number; monto_devuelto: number };
    };
    reglas: { min_clientes: number; min_puntos_distintos_entrenamiento: number; min_variables_con_variedad: number };
    advertencias: SegmentWarning[];
    motivo?: string;
    codigo_motivo?: InsufficientCode;
    division?: { total: number; entrenamiento: number; evaluacion: number; porcentaje_entrenamiento: number; semilla: number };
    diversidad_entrenamiento?: { variables_con_variedad: number; puntos_distintos: number };
    seleccion_k?: { candidatos: number[]; resultados: { k: number; silhouette: number | null; valido: boolean }[] };
    metricas?: { entrenamiento: SegmentMetrics; evaluacion: SegmentMetrics };
    modelo?: { k: number; id: string };
    grupos: CustomerSegment[];
}

export interface SegmentationResponse {
    source: SegmentationSource;
    simulated: boolean;
    status: SegmentationStatus;
    startedAt: string | null;
    finishedAt: string | null;
    errorCode: SegmentationErrorCode | null;
    canTrain: boolean;
    result: SegmentationResult | null;
}
