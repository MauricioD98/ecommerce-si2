"""Tabla RFM (recencia, frecuencia, monto): una fila por cliente de UNA tienda.

Reglas (iguales para real y simulado):
  * Fecha de corte explícita (por defecto, el momento de la extracción) y periodo [corte - N días, corte).
    Todo en UTC. Solo se usa información con fecha anterior al corte.
  * Compra válida = pedido en PROCESANDO, ENVIADO o ENTREGADO. PENDIENTE y CANCELADO no cuentan.
    Un pedido con devoluciones sigue contando: el monto es BRUTO (orders.totalAmount, que ya incluye
    envío y descuentos); las devoluciones se informan aparte y no se restan.
  * Recencia = días completos entre la última compra válida del periodo y el corte.
    Frecuencia = pedidos válidos distintos del periodo. Monto = suma de sus importes, en una sola moneda.
  * El análisis es a nivel TIENDA: se agregan las compras de todas las sucursales.
  * Las filas con problemas se excluyen y se cuentan por motivo; los archivos originales no se tocan.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from . import reglas
from .datos import DatosTienda, ErrorEntrada, a_utc

DIA = pd.Timedelta(days=1)
VARIABLES = ["recencia_dias", "frecuencia", "monto"]

# Orden en que se evalúan los motivos de exclusión de un pedido (se registra el primero que aplica)
MOTIVOS_EXCLUSION = [
    "sin_pedido_id",
    "pedido_id_conflictivo",
    "sin_cliente",
    "fecha_invalida",
    "monto_invalido",
    "monto_negativo",
    "estado_desconocido",
    "posterior_al_corte",
]


@dataclass
class TablaRFM:
    rfm: pd.DataFrame  # cliente_id, recencia_dias, frecuencia, monto, ultima_compra (solo elegibles)
    corte: pd.Timestamp
    inicio: pd.Timestamp
    resumen: dict


def construir_rfm(datos: DatosTienda, corte=None, periodo_dias: int = reglas.PERIODO_DIAS_POR_DEFECTO) -> TablaRFM:
    corte = datos.corte_extraccion if corte is None else a_utc(corte)
    if corte > datos.corte_extraccion:
        raise ErrorEntrada("La fecha de corte no puede ser posterior a la extracción: no hay datos después de ella")
    if periodo_dias < 1:
        raise ErrorEntrada("El periodo debe tener al menos 1 día")
    inicio = corte - pd.Timedelta(days=periodo_dias)

    p = datos.pedidos.copy()  # copia: el DataFrame original no se modifica
    filas_leidas = int(len(p))
    duplicados = p.duplicated(keep="first")
    p = p[~duplicados].reset_index(drop=True)

    fecha = pd.to_datetime(p["fecha"], utc=True, errors="coerce", format="ISO8601")
    monto = pd.to_numeric(p["monto"].replace("", np.nan), errors="coerce")
    estado = p["estado"].str.upper()
    repetidos = p["pedido_id"].ne("") & p["pedido_id"].duplicated(keep=False)

    condiciones = {
        "sin_pedido_id": p["pedido_id"].eq(""),
        "pedido_id_conflictivo": repetidos,  # mismo id con contenido distinto: no se elige uno al azar
        "sin_cliente": p["cliente_id"].eq(""),
        "fecha_invalida": fecha.isna(),
        "monto_invalido": monto.isna() | ~np.isfinite(monto.fillna(0)),
        "monto_negativo": monto < 0,
        "estado_desconocido": ~estado.isin(reglas.ESTADOS_VALIDOS | reglas.ESTADOS_EXCLUIDOS),
        "posterior_al_corte": fecha >= corte,
    }
    motivo = pd.Series("", index=p.index)
    for nombre in MOTIVOS_EXCLUSION:
        motivo = motivo.mask(motivo.eq("") & condiciones[nombre].fillna(False), nombre)
    aceptado = motivo.eq("")

    pedidos = pd.DataFrame({
        "pedido_id": p["pedido_id"], "cliente_id": p["cliente_id"], "fecha": fecha,
        "estado": estado, "monto": monto,
    })[aceptado]
    valido = pedidos["estado"].isin(reglas.ESTADOS_VALIDOS)
    validos = pedidos[valido]
    en_periodo = validos[validos["fecha"] >= inicio]

    # Universo de clientes: la lista de clientes de la tienda + quien aparezca en un pedido
    lista = datos.clientes["cliente_id"]
    lista = lista[lista.ne("")]
    universo = set(lista) | set(p.loc[p["cliente_id"].ne(""), "cliente_id"])
    con_validas = set(validos["cliente_id"])
    elegibles = set(en_periodo["cliente_id"])

    agrupado = en_periodo.groupby("cliente_id").agg(
        ultima_compra=("fecha", "max"), frecuencia=("pedido_id", "nunique"), monto=("monto", "sum"),
    ).reset_index()
    agrupado["recencia_dias"] = ((corte - agrupado["ultima_compra"]) // DIA).astype("int64")
    agrupado["frecuencia"] = agrupado["frecuencia"].astype("int64")
    agrupado["monto"] = agrupado["monto"].round(2)
    rfm = agrupado[["cliente_id", *VARIABLES, "ultima_compra"]].sort_values("cliente_id").reset_index(drop=True)
    assert rfm["cliente_id"].is_unique  # una fila por cliente

    # Montos extremos: solo se informan (el modelo los atenúa con log1p); nunca se recortan ni se borran
    extremos = 0
    if len(rfm) >= 4:
        q1, q3 = np.percentile(rfm["monto"], [25, 75])
        extremos = int((rfm["monto"] > q3 + 3 * (q3 - q1)).sum())

    resumen = {
        "corte": corte.isoformat(),
        "inicio_periodo": inicio.isoformat(),
        "periodo_dias": int(periodo_dias),
        "intervalo": "[inicio_periodo, corte): incluye el inicio, excluye el corte",
        "zona_horaria": reglas.ZONA_HORARIA,
        "moneda": datos.moneda,
        "nivel": "tienda (se agregan las compras de todas las sucursales)",
        "pedidos": {
            "filas_leidas": filas_leidas,
            "duplicados_exactos_descartados": int(duplicados.sum()),
            "excluidos": {m: int(motivo.eq(m).sum()) for m in MOTIVOS_EXCLUSION},
            "pendientes": int(pedidos["estado"].eq("PENDIENTE").sum()),
            "cancelados": int(pedidos["estado"].eq("CANCELADO").sum()),
            "validos_hasta_corte": int(len(validos)),
            "validos_antes_del_periodo": int(len(validos) - len(en_periodo)),
            "validos_en_periodo": int(len(en_periodo)),
        },
        "clientes": {
            "total": len(universo),
            "elegibles": len(elegibles),
            "sin_compras_validas": len(universo - con_validas),
            "sin_compras_en_periodo": len(con_validas - elegibles),
            "duplicados_en_lista": int(lista.duplicated().sum()),
        },
        "montos": {
            "regla": "suma del importe bruto de los pedidos válidos del periodo (orders.totalAmount: incluye envío y descuentos aplicados; no resta devoluciones)",
            "total_periodo": round(float(en_periodo["monto"].sum()), 2),
            "clientes_con_monto_extremo_informativo": extremos,
        },
        "devoluciones": _resumen_devoluciones(datos, en_periodo, corte),
    }
    return TablaRFM(rfm=rfm, corte=corte, inicio=inicio, resumen=resumen)


def _resumen_devoluciones(datos: DatosTienda, en_periodo: pd.DataFrame, corte: pd.Timestamp) -> dict:
    d = datos.devoluciones
    fecha = pd.to_datetime(d["fecha"], utc=True, errors="coerce", format="ISO8601")
    monto = pd.to_numeric(d["monto"].replace("", np.nan), errors="coerce")
    ok = fecha.notna() & monto.notna() & (monto >= 0) & (fecha < corte)
    del_periodo = ok & d["pedido_id"].isin(set(en_periodo["pedido_id"]))
    return {
        "regla": "informativo: devoluciones registradas antes del corte sobre pedidos válidos del periodo; NO se restan del monto",
        "filas_invalidas_o_posteriores_al_corte": int((~ok).sum()),
        "pedidos_con_devolucion": int(d.loc[del_periodo, "pedido_id"].nunique()),
        "monto_devuelto": round(float(monto[del_periodo].sum()), 2),
    }

