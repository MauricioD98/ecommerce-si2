"""División 80/20 por cliente, Pipeline de scikit-learn (log1p + escalado + K-Means), elección de k y métricas."""
from __future__ import annotations

import hashlib
import warnings
from dataclasses import dataclass
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.exceptions import ConvergenceWarning
from sklearn.metrics import davies_bouldin_score, silhouette_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import FunctionTransformer, StandardScaler

from . import reglas
from .rfm import VARIABLES


@dataclass
class Division:
    entrenamiento: list[str]
    evaluacion: list[str]


def dividir_80_20(clientes, semilla: int) -> Division:
    """Divide CLIENTES (no pedidos) de forma reproducible.

    Los ids se ordenan antes de barajar, así el resultado depende solo del conjunto de clientes y de la
    semilla (no del orden de lectura). Entrenamiento = floor(n * 8 / 10) con aritmética entera; la
    evaluación recibe el resto. Ejemplos: n=100 -> 80/20; n=101 -> 80/21; n=30 -> 24/6; n=33 -> 26/7.
    """
    ids = sorted(set(clientes))
    if len(ids) != len(list(clientes)):
        raise ValueError("Hay clientes repetidos: cada cliente debe aparecer una sola vez")
    n = len(ids)
    n_entrenamiento = n * 8 // 10
    if n_entrenamiento == 0 or n_entrenamiento == n:
        raise ValueError(f"No se puede dividir {n} clientes en 80/20")
    orden = np.random.default_rng(semilla).permutation(n)
    barajados = [ids[i] for i in orden]
    return Division(sorted(barajados[:n_entrenamiento]), sorted(barajados[n_entrenamiento:]))


def crear_pipeline(k: int, semilla: int) -> Pipeline:
    """log1p atenúa montos y frecuencias extremas (cola larga) sin recortarlos; luego media 0 / desvío 1.

    Todo se ajusta SOLO con las filas que recibe fit() (el 80 % de entrenamiento).
    """
    return Pipeline([
        ("log1p", FunctionTransformer(np.log1p, inverse_func=np.expm1, validate=True, feature_names_out="one-to-one")),
        ("escalado", StandardScaler()),
        ("kmeans", KMeans(n_clusters=k, n_init=reglas.N_INIT, random_state=semilla)),
    ])


def matriz(rfm: pd.DataFrame) -> np.ndarray:
    return rfm[VARIABLES].to_numpy(dtype=float)


def transformar(pipeline: Pipeline, X: np.ndarray) -> np.ndarray:
    return pipeline[:-1].transform(X)


def ajustar(X: np.ndarray, k: int, semilla: int) -> Pipeline:
    with warnings.catch_warnings():
        # Con puntos repetidos KMeans avisa que encontró menos grupos distintos que k: se detecta aparte
        warnings.simplefilter("ignore", ConvergenceWarning)
        return crear_pipeline(k, semilla).fit(X)


def candidatos_k(n_entrenamiento: int, puntos_distintos: int) -> list[int]:
    k_max = min(reglas.K_MAX, puntos_distintos, n_entrenamiento // reglas.MIN_CLIENTES_POR_GRUPO)
    return list(range(reglas.K_MIN, k_max + 1))


def metricas(pipeline: Pipeline, X: np.ndarray) -> dict:
    """Cohesión y separación de un conjunto con el modelo FIJO (no se reajusta nada)."""
    Xt = transformar(pipeline, X)
    etiquetas = pipeline[-1].predict(Xt)
    distancias = pipeline[-1].transform(Xt).min(axis=1)
    n, distintos = len(X), len(set(etiquetas.tolist()))
    resultado = {
        "clientes": int(n),
        "grupos_con_clientes": int(distintos),
        "inercia_media": round(float(np.mean(distancias**2)), 4),
    }
    # silhouette y Davies-Bouldin exigen 2 <= grupos con clientes <= n - 1
    if 2 <= distintos <= n - 1:
        resultado["silhouette"] = round(float(silhouette_score(Xt, etiquetas)), 4)
        resultado["davies_bouldin"] = round(float(davies_bouldin_score(Xt, etiquetas)), 4)
        resultado["motivo_no_disponible"] = None
    else:
        resultado["silhouette"] = None
        resultado["davies_bouldin"] = None
        resultado["motivo_no_disponible"] = (
            f"Los clientes de este conjunto quedaron en {distintos} grupo(s): se necesitan al menos 2 grupos y más clientes que grupos"
        )
    return resultado


def seleccionar_k(X: np.ndarray, semilla: int, candidatos: list[int]) -> tuple[int | None, list[dict]]:
    """Elige k por silhouette usando SOLO el entrenamiento. Empate: el k más chico.

    Un k cuyos clientes de entrenamiento quedan en menos grupos que k (puntos repetidos) se descarta.
    """
    tabla, mejor = [], None
    for k in candidatos:
        pipe = ajustar(X, k, semilla)
        etiquetas = pipe[-1].labels_
        distintos = len(set(etiquetas.tolist()))
        fila = {"k": k, "grupos_con_clientes": distintos, "inercia": round(float(pipe[-1].inertia_), 4)}
        if distintos < k or distintos > len(X) - 1:
            fila.update(silhouette=None, valido=False)
        else:
            fila.update(silhouette=round(float(silhouette_score(transformar(pipe, X), etiquetas)), 4), valido=True)
            if mejor is None or fila["silhouette"] > mejor["silhouette"] + 1e-9:
                mejor = fila
        tabla.append(fila)
    return (mejor["k"] if mejor else None), tabla


def sha256_de(ruta: Path) -> str:
    h = hashlib.sha256()
    with open(ruta, "rb") as f:
        for bloque in iter(lambda: f.read(1 << 20), b""):
            h.update(bloque)
    return h.hexdigest()


def guardar_modelo(pipeline: Pipeline, ruta: Path) -> str:
    temporal = ruta.with_suffix(".joblib.tmp")
    joblib.dump(pipeline, temporal, compress=3)
    temporal.replace(ruta)
    return sha256_de(ruta)


def cargar_modelo_confiable(ruta: Path, sha256_esperado: str) -> Pipeline:
    """Carga solo un modelo generado por este módulo y sin modificar.

    joblib/pickle puede ejecutar código al cargar: nunca cargar archivos de usuarios o de fuentes no
    confiables. El hash se guarda en resultado.json al entrenar y se verifica antes de abrir el archivo.
    """
    if sha256_de(ruta) != sha256_esperado:
        raise ValueError("El archivo del modelo no coincide con el hash registrado: no se carga")
    return joblib.load(ruta)
