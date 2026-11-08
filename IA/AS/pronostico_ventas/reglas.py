"""Reglas de negocio del dataset. Son las mismas para datos reales y simulados.

Todas las fechas se manejan en UTC (igual que los reportes existentes de la API, report-scope.ts).
"""

# Estados de pedido que cuentan como venta efectiva: el pago está confirmado
# (api/src/modules/reports/report-scope.ts -> PAID_STATUSES).
ESTADOS_VALIDOS = frozenset({"PROCESANDO", "ENVIADO", "ENTREGADO"})
# PENDIENTE = pago no confirmado (puede vencer); CANCELADO = cancelado o comprobante rechazado.
ESTADOS_EXCLUIDOS = frozenset({"PENDIENTE", "CANCELADO"})

# Línea sin talla (producto de talla única) y pedido sin sucursal (pedido web sin sucursal asignada)
TALLA_UNICA = "UNICA"
SIN_SUCURSAL = "SIN_SUCURSAL"

# Semanas de historial que necesita una fila para tener todas sus variables (ventas de las
# últimas 1, 2 y 4 semanas). Las semanas anteriores solo sirven de historial, no son etiquetas.
SEMANAS_HISTORIAL = 4
VENTANA_PROMEDIO = 8

# Mínimos para entrenar un modelo de una tienda. Por debajo: "datos_insuficientes".
MIN_SEMANAS_OBJETIVO = 10  # 8 de entrenamiento + 2 de prueba como mínimo
MIN_FILAS_ENTRENAMIENTO = 30
# Con menos semanas de entrenamiento no se hace búsqueda de hiperparámetros (se usan los de defecto)
MIN_SEMANAS_PARA_AJUSTE = 24

PROPORCION_ENTRENAMIENTO = 0.8
SEMILLA_POR_DEFECTO = 20261107
