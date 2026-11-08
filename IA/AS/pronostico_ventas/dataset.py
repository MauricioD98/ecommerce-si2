"""Construcción del panel semanal y de las variables (sin información futura).

Una fila = tienda (la carpeta) x sucursal x producto x talla x semana objetivo (lunes a domingo, UTC).
Etiqueta = unidades de pedidos válidos (reglas.ESTADOS_VALIDOS) creados en esa semana.

Reglas (documentadas también en README.md):
  * Cancelados y pendientes no suman unidades.
  * Las devoluciones NO se restan de la etiqueta: son un evento posterior a la compra y restarlas en
    la semana de la venta usaría información futura. Se informan aparte (`unidades_devueltas`, por la
    semana en que se registró la devolución y la sucursal que vendió).
  * Una serie se considera observada desde la semana de su primera línea de pedido (con cualquier
    estado) hasta la última semana completa antes del corte. Si el producto o la sucursal están
    inactivos, hasta la semana de su última línea (no se conoce la fecha de baja). Dentro de ese rango,
    una semana sin ventas es un 0 observado; fuera de él la semana es desconocida y no se rellena.
  * Solo semanas completas: las líneas de la semana en curso al momento del corte se descartan.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from . import reglas
from .datos import DatosTienda

CLAVE = ["sucursal_id", "producto_id", "talla"]
COLUMNAS_CATEGORICAS = ["categoria", "sucursal_id", "talla"]
COLUMNAS_NUMERICAS = [
    "u_lag1",          # unidades de la semana anterior
    "u_sum2",          # suma de las últimas 2 semanas
    "u_sum4",          # suma de las últimas 4 semanas
    "u_prom8",         # promedio de hasta 8 semanas anteriores observadas
    "semanas_historial",  # semanas observadas antes de la objetivo (tope 52)
    "sucursal_lag1",   # unidades de toda la sucursal la semana anterior
    "tienda_lag1",     # unidades de toda la tienda la semana anterior
    "sem_sin",         # calendario: semana ISO del año (seno/coseno)
    "sem_cos",
    "mes",
]
SEMANA = pd.Timedelta(days=7)


def semana_de(fechas: pd.Series) -> pd.Series:
    """Lunes 00:00 (UTC, sin zona) de la semana de cada fecha."""
    dias = fechas.dt.tz_convert("UTC").dt.tz_localize(None).dt.normalize()
    return dias - pd.to_timedelta(dias.dt.day_of_week, unit="D")


def ultima_semana_completa(corte: pd.Timestamp) -> pd.Timestamp:
    """Lunes de la última semana [lunes, lunes+7d) que terminó a más tardar en el corte."""
    c = corte.tz_convert("UTC").tz_localize(None)
    lunes_actual = c.normalize() - pd.Timedelta(days=c.weekday())
    return lunes_actual - SEMANA


@dataclass
class Dataset:
    panel: pd.DataFrame  # filas observadas (+ filas futuras con es_futura=True)
    ultima_semana: pd.Timestamp
    semana_pronostico: pd.Timestamp
    resumen: dict = field(default_factory=dict)
    productos_sin_historial: pd.DataFrame | None = None

    @property
    def elegibles(self) -> pd.DataFrame:
        """Filas con etiqueta conocida y todas las variables de historial completas."""
        p = self.panel
        return p[(~p["es_futura"]) & (p["semanas_historial"] >= reglas.SEMANAS_HISTORIAL)]

    @property
    def futuras(self) -> pd.DataFrame:
        return self.panel[self.panel["es_futura"]]


def construir_dataset(datos: DatosTienda) -> Dataset:
    ultima = ultima_semana_completa(datos.corte)
    proxima = ultima + SEMANA

    ventas = datos.ventas.copy()
    ventas["semana"] = semana_de(ventas["fecha"])
    parciales = ventas["semana"] > ultima
    cerradas = ventas[~parciales]
    validas = cerradas[cerradas["estado"].isin(reglas.ESTADOS_VALIDOS)]

    productos = datos.productos.set_index("producto_id")
    sucursales = datos.sucursales.set_index("sucursal_id")

    # Rango observado de cada serie
    rango = cerradas.groupby(CLAVE)["semana"].agg(inicio="min", ultima_linea="max").reset_index()
    prod_activo = rango["producto_id"].map(productos["activo"]).fillna(False).astype(bool)
    suc_activa = rango["sucursal_id"].map(sucursales["activa"])
    # Pedidos sin sucursal: se tratan como un canal propio, activo mientras el producto lo esté
    suc_activa = suc_activa.where(rango["sucursal_id"] != reglas.SIN_SUCURSAL, True).fillna(False).astype(bool)
    rango["activa"] = prod_activo & suc_activa
    rango["fin"] = rango["ultima_linea"].where(~rango["activa"], ultima)

    filas = []
    for serie in rango.itertuples(index=False):
        semanas = pd.date_range(serie.inicio, serie.fin, freq="7D")
        bloque = pd.DataFrame({"semana": semanas})
        bloque["es_futura"] = False
        if serie.activa:
            bloque = pd.concat([bloque, pd.DataFrame({"semana": [proxima], "es_futura": [True]})], ignore_index=True)
        for col in CLAVE:
            bloque[col] = getattr(serie, col)
        filas.append(bloque)
    columnas = ["semana", "es_futura", *CLAVE]
    if filas:
        panel = pd.concat(filas, ignore_index=True)
    else:  # tienda sin ninguna semana completa: panel vacío pero con los tipos correctos
        panel = pd.DataFrame({
            "semana": pd.Series(dtype="datetime64[us]"), "es_futura": pd.Series(dtype=bool),
            **{col: pd.Series(dtype=object) for col in CLAVE},
        })[columnas]

    unidades = validas.groupby([*CLAVE, "semana"])["unidades"].sum().rename("unidades")
    panel = panel.merge(unidades.reset_index(), on=[*CLAVE, "semana"], how="left")
    panel["unidades"] = panel["unidades"].fillna(0.0).astype(float)
    panel.loc[panel["es_futura"], "unidades"] = np.nan  # la etiqueta futura es desconocida

    dev = datos.devoluciones.copy()
    dev["semana"] = semana_de(dev["fecha"])
    dev = dev[dev["semana"] <= ultima]
    devueltas = dev.groupby([*CLAVE, "semana"])["unidades"].sum().rename("unidades_devueltas")
    panel = panel.merge(devueltas.reset_index(), on=[*CLAVE, "semana"], how="left")
    panel["unidades_devueltas"] = panel["unidades_devueltas"].fillna(0).astype(int)

    panel = panel.sort_values([*CLAVE, "semana"]).reset_index(drop=True)
    panel = _agregar_variables(panel)

    panel["categoria"] = panel["producto_id"].map(productos["categoria"]).fillna("DESCONOCIDA")
    panel["producto_nombre"] = panel["producto_id"].map(productos["nombre"]).fillna(panel["producto_id"])
    nombres_suc = sucursales["nombre"].to_dict()
    nombres_suc.setdefault(reglas.SIN_SUCURSAL, "Sin sucursal (web)")
    panel["sucursal_nombre"] = panel["sucursal_id"].map(nombres_suc).fillna(panel["sucursal_id"])

    # Productos activos que nunca tuvieron un pedido: no hay serie, se informan como datos insuficientes
    con_lineas = set(cerradas["producto_id"].unique())
    sin_historial = datos.productos[datos.productos["activo"] & ~datos.productos["producto_id"].isin(con_lineas)]

    observadas = panel[~panel["es_futura"]]
    elegibles = observadas[observadas["semanas_historial"] >= reglas.SEMANAS_HISTORIAL]
    por_estado = cerradas.groupby("estado")["unidades"].agg(["count", "sum"])
    resumen = {
        "lineas_pedido": int(len(ventas)),
        "lineas_semana_incompleta_descartadas": int(parciales.sum()),
        "lineas_por_estado": {k: int(v) for k, v in por_estado["count"].items()},
        "unidades_por_estado": {k: int(v) for k, v in por_estado["sum"].items()},
        "unidades_validas": int(validas["unidades"].sum()),
        "unidades_devueltas_informativas": int(dev["unidades"].sum()),
        "primera_venta": _fecha(cerradas["fecha"].min()),
        "ultima_venta": _fecha(cerradas["fecha"].max()),
        "series": int(len(rango)),
        "series_activas": int(rango["activa"].sum()),
        "semanas_observadas": int(observadas["semana"].nunique()),
        "filas_observadas": int(len(observadas)),
        "filas_semana_sin_ventas": int((observadas["unidades"] == 0).sum()),
        "filas_elegibles": int(len(elegibles)),
        "semanas_objetivo_elegibles": int(elegibles["semana"].nunique()),
        "productos_activos_sin_historial": int(len(sin_historial)),
    }
    return Dataset(panel, ultima, proxima, resumen, sin_historial)


def _fecha(valor) -> str | None:
    return None if pd.isna(valor) else pd.Timestamp(valor).strftime("%Y-%m-%d")


def _agregar_variables(panel: pd.DataFrame) -> pd.DataFrame:
    """Variables de la semana t calculadas solo con semanas < t de la misma tienda.

    El panel de cada serie es contiguo (una fila por semana), así que shift(k) = semana t-k.
    """
    g = panel.groupby(CLAVE, sort=False)["unidades"]
    lags = {k: g.shift(k) for k in range(1, reglas.SEMANAS_HISTORIAL + 1)}
    panel["u_lag1"] = lags[1]
    panel["u_sum2"] = lags[1] + lags[2]
    panel["u_sum4"] = lags[1] + lags[2] + lags[3] + lags[4]
    panel["u_prom8"] = g.transform(lambda s: s.shift(1).rolling(reglas.VENTANA_PROMEDIO, min_periods=1).mean())
    panel["semanas_historial"] = panel.groupby(CLAVE, sort=False).cumcount().clip(upper=52)

    # Totales de la semana anterior por sucursal y por tienda (solo semanas observadas)
    obs = panel[~panel["es_futura"]]
    tot_suc = obs.groupby(["sucursal_id", "semana"])["unidades"].sum()
    tot_tienda = obs.groupby("semana")["unidades"].sum()
    anterior = panel["semana"] - SEMANA
    panel["sucursal_lag1"] = pd.MultiIndex.from_arrays([panel["sucursal_id"], anterior]).map(tot_suc)
    panel["tienda_lag1"] = anterior.map(tot_tienda)

    semana_iso = panel["semana"].dt.isocalendar().week.astype(float)
    panel["sem_sin"] = np.sin(2 * np.pi * semana_iso / 52.18)
    panel["sem_cos"] = np.cos(2 * np.pi * semana_iso / 52.18)
    panel["mes"] = (panel["semana"] + pd.Timedelta(days=3)).dt.month.astype(float)  # mes del jueves
    return panel
