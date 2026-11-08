"""División cronológica 80/20, Pipeline de scikit-learn, líneas base y métricas."""
from __future__ import annotations

import hashlib
import itertools
from dataclasses import dataclass
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error
from sklearn.model_selection import TimeSeriesSplit
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

from . import reglas
from .dataset import COLUMNAS_CATEGORICAS, COLUMNAS_NUMERICAS

N_ARBOLES = 200
PARAMETROS_DEFECTO = {"min_samples_leaf": 5, "max_features": 1.0}
REJILLA = {"min_samples_leaf": [1, 5, 15], "max_features": [1.0, 0.5]}


@dataclass
class Division:
    semanas_entrenamiento: list[pd.Timestamp]
    semanas_prueba: list[pd.Timestamp]

    @property
    def primera_semana_prueba(self) -> pd.Timestamp:
        return self.semanas_prueba[0]


def dividir_80_20(semanas) -> Division:
    """Primeras floor(80 % de n) semanas = entrenamiento; el resto = prueba.

    Aritmética entera (n * 8 // 10) para no depender del redondeo de coma flotante.
    Ejemplos: n=100 -> 80/20; n=113 -> 90/23; n=10 -> 8/2.
    """
    ordenadas = sorted(pd.Timestamp(s) for s in set(semanas))
    n = len(ordenadas)
    n_entrenamiento = n * 8 // 10
    if n_entrenamiento == 0 or n_entrenamiento == n:
        raise ValueError(f"No se puede dividir {n} semanas en 80/20")
    return Division(ordenadas[:n_entrenamiento], ordenadas[n_entrenamiento:])


def crear_pipeline(semilla: int, parametros: dict | None = None) -> Pipeline:
    """Preprocesamiento + bosque aleatorio. Se ajusta SOLO con las filas que recibe en fit()."""
    preprocesamiento = ColumnTransformer(
        [
            # Categoría/sucursal/talla desconocidas en el ajuste -> vector de ceros (explícito)
            ("categoricas", OneHotEncoder(handle_unknown="ignore", sparse_output=False), COLUMNAS_CATEGORICAS),
            ("numericas", "passthrough", COLUMNAS_NUMERICAS),
        ]
    )
    modelo = RandomForestRegressor(
        n_estimators=N_ARBOLES,
        random_state=semilla,
        n_jobs=-1,
        **(parametros or PARAMETROS_DEFECTO),
    )
    return Pipeline([("preprocesamiento", preprocesamiento), ("bosque", modelo)])


def predecir(pipeline: Pipeline, filas: pd.DataFrame) -> np.ndarray:
    """Unidades no negativas (con decimales; el redondeo es solo para mostrar).

    Se predice con n_jobs=1: en paralelo el orden de suma de los árboles cambia y el resultado
    varía en el último decimal (~1e-15), lo que rompe la reproducibilidad exacta.
    """
    pipeline.set_params(bosque__n_jobs=1)
    return np.clip(pipeline.predict(filas[COLUMNAS_CATEGORICAS + COLUMNAS_NUMERICAS]), 0.0, None)


def linea_base_promedio4(filas: pd.DataFrame) -> np.ndarray:
    """Línea base principal (fijada de antemano): promedio de las últimas 4 semanas."""
    return filas["u_sum4"].to_numpy(dtype=float) / 4.0


def linea_base_semana_anterior(filas: pd.DataFrame) -> np.ndarray:
    return filas["u_lag1"].to_numpy(dtype=float)


def mae(reales, previstas) -> float:
    return float(mean_absolute_error(np.asarray(reales, dtype=float), np.asarray(previstas, dtype=float)))


def ajustar_hiperparametros(entrenamiento: pd.DataFrame, semilla: int) -> tuple[dict, list[dict]]:
    """Validación cronológica dentro del 80 % (TimeSeriesSplit sobre semanas completas).

    El 20 % de prueba no participa. Con pocas semanas se usan los parámetros por defecto.
    """
    semanas = np.array(sorted(entrenamiento["semana"].unique()))
    if len(semanas) < reglas.MIN_SEMANAS_PARA_AJUSTE:
        return dict(PARAMETROS_DEFECTO), []

    divisor = TimeSeriesSplit(n_splits=3)
    resultados = []
    for hoja, rasgos in itertools.product(REJILLA["min_samples_leaf"], REJILLA["max_features"]):
        parametros = {"min_samples_leaf": hoja, "max_features": rasgos}
        errores = []
        for idx_ajuste, idx_validacion in divisor.split(semanas):
            ajuste = entrenamiento[entrenamiento["semana"].isin(semanas[idx_ajuste])]
            validacion = entrenamiento[entrenamiento["semana"].isin(semanas[idx_validacion])]
            pipeline = crear_pipeline(semilla, parametros).fit(ajuste, ajuste["unidades"])
            errores.append(mae(validacion["unidades"], predecir(pipeline, validacion)))
        resultados.append({**parametros, "mae_validacion_promedio": round(float(np.mean(errores)), 4)})
    mejor = min(resultados, key=lambda r: r["mae_validacion_promedio"])  # empate: el primero de la rejilla
    return {"min_samples_leaf": mejor["min_samples_leaf"], "max_features": mejor["max_features"]}, resultados


def sha256_de(ruta: Path) -> str:
    h = hashlib.sha256()
    with open(ruta, "rb") as f:
        for bloque in iter(lambda: f.read(1 << 20), b""):
            h.update(bloque)
    return h.hexdigest()


def guardar_modelo(pipeline: Pipeline, ruta: Path) -> str:
    joblib.dump(pipeline, ruta, compress=3)
    return sha256_de(ruta)


def cargar_modelo_confiable(ruta: Path, sha256_esperado: str) -> Pipeline:
    """Carga solo un modelo generado por este módulo y sin modificar.

    joblib/pickle puede ejecutar código al cargar: nunca cargar archivos de usuarios o de fuentes no
    confiables. El hash se guarda en resultado.json al entrenar y se verifica antes de abrir el archivo.
    """
    if sha256_de(ruta) != sha256_esperado:
        raise ValueError("El archivo del modelo no coincide con el hash registrado: no se carga")
    return joblib.load(ruta)
