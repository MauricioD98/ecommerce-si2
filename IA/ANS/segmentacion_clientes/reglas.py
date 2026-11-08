"""Reglas y parámetros de la segmentación. Son los mismos para datos reales y simulados.

Los mínimos de esta implementación son criterios propios de esta demo académica (no reglas universales):
sirven para no presentar grupos calculados con muy pocos clientes o con clientes casi idénticos.
"""

# Pedidos que cuentan como compra válida: pago confirmado
# (api/src/modules/reports/report-scope.ts -> PAID_STATUSES).
ESTADOS_VALIDOS = frozenset({"PROCESANDO", "ENVIADO", "ENTREGADO"})
# PENDIENTE = pago no confirmado (puede vencer); CANCELADO = cancelado o comprobante rechazado.
ESTADOS_EXCLUIDOS = frozenset({"PENDIENTE", "CANCELADO"})

# Zona horaria de todas las fechas (igual que los reportes de la API) y periodo por defecto.
ZONA_HORARIA = "UTC"
PERIODO_DIAS_POR_DEFECTO = 365  # [corte - 365 días, corte)

# División por cliente: entrenamiento = floor(n * 8 / 10); evaluación = el resto.
PROPORCION_ENTRENAMIENTO = 0.8
SEMILLA_POR_DEFECTO = 20261107

# Mínimos de esta implementación (configurables por línea de comandos).
MIN_CLIENTES = 30  # elegibles; con 30 quedan 24 de entrenamiento y 6 de evaluación
MIN_PUNTOS_DISTINTOS_ENTRENAMIENTO = 8  # combinaciones RFM distintas dentro del 80 %
MIN_VARIABLES_CON_VARIEDAD = 2  # de las tres variables, cuántas deben tener más de un valor distinto
MIN_CLIENTES_POR_GRUPO = 5  # k máximo = floor(entrenamiento / 5)

# Candidatos de K-Means (se recortan según los datos) y parámetros fijos del algoritmo
K_MIN = 2
K_MAX = 6
N_INIT = 10

# Silhouette por debajo de este valor se informa como "separación débil" (orientativo)
SILHOUETTE_DEBIL = 0.25

# Comparación de la mediana de un grupo con la mediana de toda la tienda (para la descripción)
RAZON_MENOR = 0.8
RAZON_MAYOR = 1.25
