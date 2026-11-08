"""Entrenamiento, evaluación 80/20 y pronóstico de la próxima semana para UNA tienda."""
from __future__ import annotations

import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from . import VERSION_MODELO, reglas
from .datos import DatosTienda, cargar_carpeta
from .dataset import COLUMNAS_CATEGORICAS, COLUMNAS_NUMERICAS, SEMANA, Dataset, construir_dataset
from .modelo import (
    ajustar_hiperparametros,
    crear_pipeline,
    dividir_80_20,
    guardar_modelo,
    linea_base_promedio4,
    linea_base_semana_anterior,
    mae,
    predecir,
)

AVISO_SIMULADO = (
    "DATOS SIMULADOS para demostración: no son ventas reales y sus métricas no prueban la "
    "precisión del modelo con ventas reales."
)
AVISO_REAL = "Datos reales de la tienda autenticada (extracción de solo lectura)."

LIMITACIONES = [
    "Se pronostican ventas observadas, no la demanda total: si faltó stock, las ventas reales pudieron quedar por debajo de la demanda.",
    "No existe historial fiable de precio, promociones ni stock por fecha, así que el modelo no los usa.",
    "Se usa el estado actual de cada pedido (no hay historial de estados): un pedido cancelado después se excluye de su semana.",
    "Las devoluciones no se restan de la etiqueta; se informan aparte.",
    "Las semanas son de lunes a domingo en UTC, igual que los reportes existentes.",
    "La variante es la talla registrada en la línea del pedido; el color no se guarda por línea.",
    "Las métricas corresponden al modelo entrenado con el 80 % inicial; el pronóstico publicado usa el mismo modelo reentrenado con el 100 % de las semanas elegibles.",
]


def _mostrar(valor: float) -> int:
    """Redondeo para mostrar: al entero más cercano, .5 hacia arriba (no negativo)."""
    return int(math.floor(max(valor, 0.0) + 0.5))


def _dia(ts: pd.Timestamp) -> str:
    return pd.Timestamp(ts).strftime("%Y-%m-%d")


def _resumen_conjunto(filas: pd.DataFrame, semanas: list[pd.Timestamp]) -> dict:
    return {
        "semanas": len(semanas),
        "filas": int(len(filas)),
        "desde": _dia(semanas[0]),
        "hasta": _dia(semanas[-1] + SEMANA - pd.Timedelta(days=1)),
    }


def _fila_pronostico(fila, unidades: float | None, metodo: str) -> dict:
    return {
        "sucursal_id": fila.sucursal_id,
        "sucursal_nombre": fila.sucursal_nombre,
        "producto_id": fila.producto_id,
        "producto_nombre": fila.producto_nombre,
        "categoria": fila.categoria,
        "talla": fila.talla,
        "semanas_historial": int(fila.semanas_historial),
        "metodo": metodo,
        "unidades_previstas": None if unidades is None else round(float(unidades), 2),
        "unidades_mostradas": None if unidades is None else _mostrar(float(unidades)),
    }


def _pronostico(ds: Dataset, modelo_final) -> list[dict]:
    futuras = ds.futuras
    filas: list[dict] = []
    con_modelo = futuras[futuras["semanas_historial"] >= reglas.SEMANAS_HISTORIAL]
    previstas = predecir(modelo_final, con_modelo) if modelo_final is not None and len(con_modelo) else []
    for fila, valor in zip(con_modelo.itertuples(index=False), previstas):
        filas.append(_fila_pronostico(fila, valor, "modelo"))
    # Historial de 1 a 3 semanas: estimación alternativa, NO es del modelo
    for fila in futuras[futuras["semanas_historial"] < reglas.SEMANAS_HISTORIAL].itertuples(index=False):
        if fila.semanas_historial >= 1:
            filas.append(_fila_pronostico(fila, fila.u_prom8, "alternativa_promedio"))
        else:
            filas.append(_fila_pronostico(fila, None, "datos_insuficientes"))
    if modelo_final is None:  # tienda sin modelo: todo lo que habría ido al modelo también es alternativa
        for fila in con_modelo.itertuples(index=False):
            filas.append(_fila_pronostico(fila, fila.u_prom8, "alternativa_promedio"))
    for prod in ds.productos_sin_historial.itertuples(index=False):
        filas.append({
            "sucursal_id": None, "sucursal_nombre": None, "producto_id": prod.producto_id,
            "producto_nombre": prod.nombre, "categoria": prod.categoria, "talla": None,
            "semanas_historial": 0, "metodo": "datos_insuficientes",
            "unidades_previstas": None, "unidades_mostradas": None,
        })
    orden = {"modelo": 0, "alternativa_promedio": 1, "datos_insuficientes": 2}
    filas.sort(key=lambda f: (orden[f["metodo"]], -(f["unidades_previstas"] or 0), f["sucursal_nombre"] or "", f["producto_nombre"], f["talla"] or ""))
    return filas


def entrenar_tienda(datos: DatosTienda, salida: Path, semilla: int = reglas.SEMILLA_POR_DEFECTO) -> dict:
    salida.mkdir(parents=True, exist_ok=True)
    ds = construir_dataset(datos)
    elegibles = ds.elegibles
    semanas = sorted(elegibles["semana"].unique())

    resultado: dict = {
        "version_formato": 1,
        "version_modelo": VERSION_MODELO,
        "origen": datos.origen,
        "aviso_origen": AVISO_SIMULADO if datos.origen == "simulado" else AVISO_REAL,
        "tienda_id": datos.tienda_id,
        "tienda_nombre": datos.tienda_nombre,
        "semilla": semilla,
        "semilla_datos": datos.semilla,
        "entrenado_en": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "corte_extraccion": datos.corte.isoformat(),
        # Fin de la última semana completa: la información usada llega hasta acá
        "corte_datos": _dia(ds.semana_pronostico - pd.Timedelta(days=1)),
        "periodo_pronosticado": {"desde": _dia(ds.semana_pronostico), "hasta": _dia(ds.semana_pronostico + pd.Timedelta(days=6))},
        "datos": ds.resumen,
        "reglas": {
            "estados_validos": sorted(reglas.ESTADOS_VALIDOS),
            "estados_excluidos": sorted(reglas.ESTADOS_EXCLUIDOS),
            "semanas_historial_requeridas": reglas.SEMANAS_HISTORIAL,
            "min_semanas_objetivo": reglas.MIN_SEMANAS_OBJETIVO,
            "min_filas_entrenamiento": reglas.MIN_FILAS_ENTRENAMIENTO,
            "semana": "lunes a domingo, UTC",
        },
        "limitaciones": LIMITACIONES,
    }

    insuficiente = len(semanas) < reglas.MIN_SEMANAS_OBJETIVO
    if not insuficiente:
        division = dividir_80_20(semanas)
        entrenamiento = elegibles[elegibles["semana"].isin(division.semanas_entrenamiento)]
        insuficiente = len(entrenamiento) < reglas.MIN_FILAS_ENTRENAMIENTO
    if insuficiente:
        resultado["estado"] = "datos_insuficientes"
        resultado["motivo"] = (
            f"Hay {len(semanas)} semanas objetivo elegibles y {len(elegibles)} filas; se necesitan al menos "
            f"{reglas.MIN_SEMANAS_OBJETIVO} semanas y {reglas.MIN_FILAS_ENTRENAMIENTO} filas de entrenamiento."
        )
        resultado["pronostico"] = _pronostico(ds, None)
        (salida / "modelo.joblib").unlink(missing_ok=True)  # no dejar un modelo viejo que parezca vigente
        _escribir(salida, resultado, ds)
        return resultado

    prueba = elegibles[elegibles["semana"].isin(division.semanas_prueba)]
    # Garantía de no solapamiento: toda etiqueta de entrenamiento termina antes del primer corte de prueba
    assert max(division.semanas_entrenamiento) + SEMANA <= division.primera_semana_prueba

    parametros, busqueda = ajustar_hiperparametros(entrenamiento, semilla)
    modelo_eval = crear_pipeline(semilla, parametros).fit(entrenamiento, entrenamiento["unidades"])
    pred_modelo = predecir(modelo_eval, prueba)
    reales = prueba["unidades"].to_numpy(dtype=float)
    mae_modelo = mae(reales, pred_modelo)
    mae_base4 = mae(reales, linea_base_promedio4(prueba))
    mae_base1 = mae(reales, linea_base_semana_anterior(prueba))

    # Modelo publicado: mismos hiperparámetros, reentrenado con todas las semanas elegibles
    modelo_final = crear_pipeline(semilla, parametros).fit(elegibles, elegibles["unidades"])
    sha = guardar_modelo(modelo_final, salida / "modelo.joblib")

    resultado["estado"] = "listo"
    resultado["division"] = {
        "regla": "cronológica por semana objetivo: primeras floor(n*8/10) semanas = entrenamiento, resto = prueba; todas las filas de una semana quedan del mismo lado",
        "semanas_objetivo": len(semanas),
        "entrenamiento": _resumen_conjunto(entrenamiento, division.semanas_entrenamiento),
        "prueba": _resumen_conjunto(prueba, division.semanas_prueba),
        "porcentaje_semanas_entrenamiento": round(100 * len(division.semanas_entrenamiento) / len(semanas), 2),
        "porcentaje_filas_entrenamiento": round(100 * len(entrenamiento) / len(elegibles), 2),
        "separacion": "ninguna necesaria: la última etiqueta de entrenamiento termina el domingo anterior al primer lunes de prueba",
        "evaluacion": "modelo fijo (entrenado una vez con el 80 %); cada semana de prueba usa como historial solo semanas anteriores ya observadas, igual que la línea base",
    }
    resultado["modelo"] = {
        "tipo": "RandomForestRegressor (scikit-learn Pipeline: OneHotEncoder(handle_unknown='ignore') + bosque)",
        "n_estimators": 200,
        "hiperparametros": parametros,
        "ajuste_hiperparametros": {
            "metodo": "TimeSeriesSplit(n_splits=3) sobre semanas del 80 % de entrenamiento" if busqueda else f"sin búsqueda (menos de {reglas.MIN_SEMANAS_PARA_AJUSTE} semanas de entrenamiento)",
            "resultados": busqueda,
        },
        "variables_categoricas": COLUMNAS_CATEGORICAS,
        "variables_numericas": COLUMNAS_NUMERICAS,
        "archivo": "modelo.joblib",
        "sha256": sha,
        "modelo_publicado": "reentrenado con el 100 % de las semanas elegibles, mismos hiperparámetros",
    }
    resultado["metricas_prueba"] = {
        "filas": int(len(prueba)),
        "mae_modelo": round(mae_modelo, 4),
        "mae_linea_base_promedio_4_semanas": round(mae_base4, 4),
        "mae_linea_base_semana_anterior": round(mae_base1, 4),
        "linea_base_principal": "promedio_4_semanas",
        "supera_linea_base_principal": bool(mae_modelo < mae_base4),
        "unidades_reales_promedio": round(float(reales.mean()), 4),
        "explicacion": "MAE = promedio de |real - previsto| en unidades por fila (sucursal x producto x talla x semana). Menor es mejor.",
    }
    resultado["pronostico"] = _pronostico(ds, modelo_final)
    _escribir(salida, resultado, ds, division)
    return resultado


def _escribir(salida: Path, resultado: dict, ds: Dataset, division=None) -> None:
    panel = ds.panel.copy()
    panel["conjunto"] = "historial"
    elegible = (~panel["es_futura"]) & (panel["semanas_historial"] >= reglas.SEMANAS_HISTORIAL)
    if division is not None:
        panel.loc[elegible & panel["semana"].isin(division.semanas_entrenamiento), "conjunto"] = "entrenamiento"
        panel.loc[elegible & panel["semana"].isin(division.semanas_prueba), "conjunto"] = "prueba"
    else:
        panel.loc[elegible, "conjunto"] = "elegible"
    panel.loc[panel["es_futura"], "conjunto"] = "pronostico"
    panel.to_csv(salida / "dataset.csv", index=False, date_format="%Y-%m-%d")
    if resultado["origen"] == "simulado":
        (salida / "DATOS_SIMULADOS.txt").write_text(AVISO_SIMULADO + "\n", encoding="utf-8")

    temporal = salida / "resultado.json.tmp"
    temporal.write_text(json.dumps(resultado, ensure_ascii=False, indent=2, default=_json), encoding="utf-8")
    os.replace(temporal, salida / "resultado.json")  # escritura atómica: la API nunca lee un JSON a medias


def _json(valor):
    if isinstance(valor, (np.integer,)):
        return int(valor)
    if isinstance(valor, (np.floating,)):
        return float(valor)
    if isinstance(valor, (pd.Timestamp,)):
        return valor.isoformat()
    raise TypeError(type(valor))


def entrenar_desde_carpeta(entrada: Path, salida: Path, semilla: int) -> dict:
    return entrenar_tienda(cargar_carpeta(entrada), salida, semilla)
