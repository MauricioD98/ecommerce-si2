"""Construye RFM, divide 80/20 por cliente, elige k con el 80 %, evalúa en el 20 % y resume los grupos (UNA tienda)."""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from . import VERSION_MODELO, reglas
from .datos import DatosTienda, cargar_carpeta
from .modelo import (
    ajustar,
    candidatos_k,
    dividir_80_20,
    guardar_modelo,
    matriz,
    metricas,
    seleccionar_k,
    transformar,
)
from .rfm import VARIABLES, TablaRFM, construir_rfm

AVISO_SIMULADO = (
    "DATOS DE DEMOSTRACIÓN: clientes y compras ficticios. Los grupos solo muestran el recorrido técnico; "
    "no describen clientes reales."
)
AVISO_REAL = "Datos reales de la tienda autenticada (extracción de solo lectura)."
MARCA = "DATOS_SIMULADOS.txt"

LIMITACIONES = [
    "Los grupos los descubre K-Means sin etiquetas previas; su numeración puede cambiar al reentrenar y no es una categoría permanente.",
    "La separación matemática (silhouette, Davies-Bouldin) es orientativa: no demuestra utilidad comercial ni garantiza comportamiento futuro.",
    "No se predice que un cliente dejará de comprar ni se ejecuta ninguna acción, mensaje o descuento por pertenecer a un grupo.",
    "El monto es bruto (orders.totalAmount): las devoluciones se informan aparte y no se restan.",
    "No existe historial de estados de pedido: se usa el estado actual de cada pedido en el momento de la extracción.",
    "El 80/20 divide clientes con la misma fecha de corte; no es una evaluación sobre fechas futuras.",
    "El análisis es por tienda: agrega las compras de todas las sucursales. Las ventas POS sin cliente registrado (consumidor final) no se atribuyen a ningún cliente.",
]

VARIABLES_DESCRIPCION = {
    "recencia_dias": ("días desde la última compra", {"menor": "compraron más recientemente", "similar": "recencia similar", "mayor": "llevan más tiempo sin comprar"}),
    "frecuencia": ("pedidos en el periodo", {"menor": "compran con menos frecuencia", "similar": "frecuencia similar", "mayor": "compran con más frecuencia"}),
    "monto": ("monto en el periodo", {"menor": "gastan menos", "similar": "gasto similar", "mayor": "gastan más"}),
}


def _estadisticas(serie: pd.Series) -> dict:
    v = serie.to_numpy(dtype=float)
    p25, p50, p75 = np.percentile(v, [25, 50, 75])
    return {
        "mediana": round(float(p50), 2), "p25": round(float(p25), 2), "p75": round(float(p75), 2),
        "promedio": round(float(v.mean()), 2), "min": round(float(v.min()), 2), "max": round(float(v.max()), 2),
    }


def _comparar(mediana_grupo: float, mediana_tienda: float) -> str:
    """Compara con la mediana de la tienda; +1 evita dividir por cero (recencia 0 días)."""
    razon = (mediana_grupo + 1.0) / (mediana_tienda + 1.0)
    return "menor" if razon < reglas.RAZON_MENOR else "mayor" if razon > reglas.RAZON_MAYOR else "similar"


def _resumir_grupos(rfm: pd.DataFrame, centros: np.ndarray) -> tuple[list[dict], dict[int, int]]:
    medianas_tienda = {v: float(rfm[v].median()) for v in VARIABLES}
    crudos = []
    for etiqueta, filas in rfm.groupby("etiqueta"):
        crudos.append((int(etiqueta), filas))
    # Numeración estable para mostrar: mayor monto mediano primero (luego frecuencia, luego recencia)
    crudos.sort(key=lambda t: (-t[1]["monto"].median(), -t[1]["frecuencia"].median(), t[1]["recencia_dias"].median(), t[0]))
    numeracion = {etiqueta: i + 1 for i, (etiqueta, _) in enumerate(crudos)}
    grupos = []
    for etiqueta, filas in crudos:
        estad = {v: _estadisticas(filas[v]) for v in VARIABLES}
        comparacion = {v: _comparar(estad[v]["mediana"], medianas_tienda[v]) for v in VARIABLES}
        texto = "; ".join(VARIABLES_DESCRIPCION[v][1][comparacion[v]] for v in VARIABLES)
        grupos.append({
            "grupo": numeracion[etiqueta],
            "etiqueta_kmeans": etiqueta,
            "clientes": int(len(filas)),
            "clientes_entrenamiento": int(filas["conjunto"].eq("entrenamiento").sum()),
            "clientes_evaluacion": int(filas["conjunto"].eq("evaluacion").sum()),
            "porcentaje": round(100 * len(filas) / len(rfm), 2),
            "rfm": estad,
            "centro_aproximado": {v: round(float(centros[etiqueta][i]), 2) for i, v in enumerate(VARIABLES)},
            "comparacion_con_tienda": comparacion,
            "descripcion": f"Respecto de la mediana de la tienda: {texto}.",
        })
    return grupos, numeracion


def _base(datos: DatosTienda, tabla: TablaRFM, semilla: int) -> dict:
    return {
        "version_formato": 1,
        "version_modelo": VERSION_MODELO,
        "origen": datos.origen,
        "aviso_origen": AVISO_SIMULADO if datos.origen == "simulado" else AVISO_REAL,
        "tienda_id": datos.tienda_id,
        "tienda_nombre": datos.tienda_nombre,
        "semilla": semilla,
        "semilla_datos": datos.semilla,
        "entrenado_en": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "corte_extraccion": datos.corte_extraccion.isoformat(),
        "corte": tabla.corte.isoformat(),
        "periodo": {"desde": tabla.inicio.isoformat(), "hasta_exclusivo": tabla.corte.isoformat(), "dias": tabla.resumen["periodo_dias"]},
        "zona_horaria": reglas.ZONA_HORARIA,
        "moneda": datos.moneda,
        "datos": tabla.resumen,
        "reglas": {
            "estados_validos": sorted(reglas.ESTADOS_VALIDOS),
            "estados_excluidos": sorted(reglas.ESTADOS_EXCLUIDOS),
            "min_clientes": reglas.MIN_CLIENTES,
            "min_puntos_distintos_entrenamiento": reglas.MIN_PUNTOS_DISTINTOS_ENTRENAMIENTO,
            "min_variables_con_variedad": reglas.MIN_VARIABLES_CON_VARIEDAD,
            "min_clientes_por_grupo": reglas.MIN_CLIENTES_POR_GRUPO,
            "k_candidatos": [reglas.K_MIN, reglas.K_MAX],
            "nota": "Mínimos propios de esta implementación (no son reglas universales).",
        },
        "limitaciones": LIMITACIONES,
        "advertencias": [],
    }


def _advertir(resultado: dict, codigo: str, texto: str, **parametros) -> None:
    """Advertencias con código (la web las traduce) y texto en español (CLI)."""
    resultado["advertencias"].append({"codigo": codigo, "texto": texto, **parametros})


def _insuficiente(resultado: dict, motivo: str, codigo: str, salida: Path, rfm: pd.DataFrame | None = None) -> dict:
    resultado.update(estado="datos_insuficientes", motivo=motivo, codigo_motivo=codigo, grupos=[])
    (salida / "modelo.joblib").unlink(missing_ok=True)  # no dejar un modelo viejo que parezca vigente
    (salida / "asignaciones.csv").unlink(missing_ok=True)
    _escribir(salida, resultado)
    return resultado


def entrenar_tienda(datos: DatosTienda, salida: Path, semilla: int = reglas.SEMILLA_POR_DEFECTO,
                    corte=None, periodo_dias: int = reglas.PERIODO_DIAS_POR_DEFECTO) -> dict:
    salida.mkdir(parents=True, exist_ok=True)
    tabla = construir_rfm(datos, corte, periodo_dias)
    rfm = tabla.rfm.copy()
    resultado = _base(datos, tabla, semilla)
    if datos.origen == "real" and tabla.corte < datos.corte_extraccion:
        _advertir(resultado, "corte_anterior_extraccion",
                  "El corte es anterior a la extracción: los estados de los pedidos son los actuales, no los que tenían en la fecha de corte.")

    n = len(rfm)
    if n < reglas.MIN_CLIENTES:
        return _insuficiente(resultado, f"Hay {n} clientes elegibles; esta implementación necesita al menos {reglas.MIN_CLIENTES}.", "pocos_clientes", salida)

    division = dividir_80_20(rfm["cliente_id"], semilla)
    rfm["conjunto"] = np.where(rfm["cliente_id"].isin(set(division.entrenamiento)), "entrenamiento", "evaluacion")
    entrenamiento = rfm[rfm["conjunto"] == "entrenamiento"]
    evaluacion = rfm[rfm["conjunto"] == "evaluacion"]
    assert not set(entrenamiento["cliente_id"]) & set(evaluacion["cliente_id"])
    resultado["division"] = {
        "unidad": "cliente elegible (una fila RFM por cliente y tienda, misma fecha de corte)",
        "regla": "clientes ordenados por id y barajados con la semilla; entrenamiento = floor(n*8/10), evaluación = el resto",
        "total": n,
        "entrenamiento": int(len(entrenamiento)),
        "evaluacion": int(len(evaluacion)),
        "porcentaje_entrenamiento": round(100 * len(entrenamiento) / n, 2),
        "semilla": semilla,
        "ajuste": "log1p, escalado, elección de k y K-Means se ajustan solo con el entrenamiento; la evaluación solo se transforma y se asigna",
    }

    X_ent = matriz(entrenamiento)
    con_variedad = int(sum(len(np.unique(X_ent[:, i])) > 1 for i in range(X_ent.shape[1])))
    puntos = int(len(np.unique(X_ent, axis=0)))
    resultado["diversidad_entrenamiento"] = {"variables_con_variedad": con_variedad, "puntos_distintos": puntos}
    if con_variedad < reglas.MIN_VARIABLES_CON_VARIEDAD or puntos < reglas.MIN_PUNTOS_DISTINTOS_ENTRENAMIENTO:
        return _insuficiente(
            resultado,
            f"El entrenamiento tiene {puntos} combinaciones RFM distintas y {con_variedad} variable(s) con variedad; "
            f"se necesitan {reglas.MIN_PUNTOS_DISTINTOS_ENTRENAMIENTO} y {reglas.MIN_VARIABLES_CON_VARIEDAD}.",
            "poca_diversidad", salida,
        )

    candidatos = candidatos_k(len(entrenamiento), puntos)
    k, busqueda = seleccionar_k(X_ent, semilla, candidatos)
    resultado["seleccion_k"] = {
        "metodo": "silhouette sobre el 80 % de entrenamiento (mayor es mejor; empate: k menor)",
        "candidatos": candidatos,
        "resultados": busqueda,
    }
    if k is None:
        return _insuficiente(resultado, "Ningún número de grupos candidato produjo grupos distintos con estos datos.", "sin_k_valido", salida)

    if k == candidatos[-1] and len(candidatos) > 1:
        _advertir(resultado, "k_maximo",
                  f"El k elegido ({k}) es el mayor candidato probado: la silhouette seguía subiendo y otro rango podría dar otra cantidad de grupos.", k=k)
    pipeline = ajustar(X_ent, k, semilla)
    m_ent, m_eval = metricas(pipeline, X_ent), metricas(pipeline, matriz(evaluacion))
    resultado["metricas"] = {
        "entrenamiento": m_ent,
        "evaluacion": m_eval,
        "explicacion": (
            "silhouette: de -1 a 1, mayor = grupos más compactos y separados. Davies-Bouldin: 0 o más, menor es mejor. "
            "inercia_media: distancia cuadrática media al centro asignado en la escala del modelo (comparar entrenamiento con evaluación). "
            "No son porcentajes de precisión: no existen etiquetas correctas."
        ),
    }
    if m_ent["silhouette"] is not None and m_ent["silhouette"] < reglas.SILHOUETTE_DEBIL:
        _advertir(resultado, "separacion_debil", f"Separación débil entre grupos (silhouette de entrenamiento < {reglas.SILHOUETTE_DEBIL}).",
                  umbral=reglas.SILHOUETTE_DEBIL)
    if m_eval["grupos_con_clientes"] < 2:
        _advertir(resultado, "evaluacion_un_grupo", "En la evaluación todos los clientes cayeron en un solo grupo: métricas de evaluación no disponibles.")

    # Todos los clientes elegibles se asignan con el modelo FIJO (sin reajustar con la evaluación)
    rfm["etiqueta"] = pipeline[-1].predict(transformar(pipeline, matriz(rfm)))
    centros = pipeline[:-1].inverse_transform(pipeline[-1].cluster_centers_)
    grupos, numeracion = _resumir_grupos(rfm, centros)
    vacios = sorted(set(range(k)) - set(rfm["etiqueta"].tolist()))
    if vacios:
        _advertir(resultado, "grupos_vacios", f"{len(vacios)} grupo(s) del modelo no tienen clientes asignados.", n=len(vacios))

    sha = guardar_modelo(pipeline, salida / "modelo.joblib")
    resultado["estado"] = "listo"
    resultado["modelo"] = {
        "tipo": "scikit-learn Pipeline: FunctionTransformer(log1p) + StandardScaler + KMeans",
        "k": k,
        "n_init": reglas.N_INIT,
        "random_state": semilla,
        "variables": VARIABLES,
        "archivo": "modelo.joblib",
        "sha256": sha,
        "id": f"{sha[:12]}",
        "transformacion": "log1p: los montos y frecuencias tienen cola larga; atenúa extremos sin recortarlos ni borrarlos",
    }
    resultado["grupos"] = grupos

    asignaciones = rfm.assign(grupo=rfm["etiqueta"].map(numeracion))[["cliente_id", "conjunto", "grupo", *VARIABLES]]
    asignaciones.to_csv(salida / "asignaciones.csv", index=False)
    _escribir(salida, resultado)
    return resultado


def _escribir(salida: Path, resultado: dict) -> None:
    if resultado["origen"] == "simulado":
        (salida / MARCA).write_text(AVISO_SIMULADO + "\n", encoding="utf-8")
    temporal = salida / "resultado.json.tmp"
    temporal.write_text(json.dumps(resultado, ensure_ascii=False, indent=2, default=_json), encoding="utf-8")
    os.replace(temporal, salida / "resultado.json")  # escritura atómica: la API nunca lee un JSON a medias


def _json(valor):
    if isinstance(valor, np.integer):
        return int(valor)
    if isinstance(valor, np.floating):
        return float(valor)
    if isinstance(valor, pd.Timestamp):
        return valor.isoformat()
    raise TypeError(type(valor))


def entrenar_desde_carpeta(entrada: Path, salida: Path, semilla: int, corte=None,
                           periodo_dias: int = reglas.PERIODO_DIAS_POR_DEFECTO) -> dict:
    return entrenar_tienda(cargar_carpeta(entrada), salida, semilla, corte, periodo_dias)
