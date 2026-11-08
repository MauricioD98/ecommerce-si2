import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from segmentacion_clientes import reglas
from segmentacion_clientes.entrenamiento import entrenar_tienda
from segmentacion_clientes.modelo import (
    ajustar,
    candidatos_k,
    cargar_modelo_confiable,
    dividir_80_20,
    metricas,
)
from tests.ayudantes import tienda_variada


class Division8020Test(unittest.TestCase):
    def test_proporciones_y_redondeo(self):
        for n, esperado in ((100, (80, 20)), (101, (80, 21)), (30, (24, 6)), (33, (26, 7)), (5, (4, 1))):
            d = dividir_80_20([f"c{i}" for i in range(n)], 7)
            self.assertEqual((len(d.entrenamiento), len(d.evaluacion)), esperado)

    def test_reproducible_y_sin_solapamiento(self):
        ids = [f"c{i}" for i in range(57)]
        a, b = dividir_80_20(ids, 11), dividir_80_20(list(reversed(ids)), 11)
        self.assertEqual(a, b)  # no depende del orden de lectura
        self.assertNotEqual(a.entrenamiento, dividir_80_20(ids, 12).entrenamiento)
        self.assertFalse(set(a.entrenamiento) & set(a.evaluacion))
        self.assertEqual(set(a.entrenamiento) | set(a.evaluacion), set(ids))

    def test_rechaza_repetidos_y_conjuntos_minimos(self):
        with self.assertRaises(ValueError):
            dividir_80_20(["a", "a", "b"], 1)
        with self.assertRaises(ValueError):
            dividir_80_20(["a"], 1)


class ClusteringTest(unittest.TestCase):
    def test_candidatos_k(self):
        self.assertEqual(candidatos_k(172, 172), [2, 3, 4, 5, 6])
        self.assertEqual(candidatos_k(24, 24), [2, 3, 4])  # 24 // 5 = 4
        self.assertEqual(candidatos_k(100, 3), [2, 3])  # no más grupos que puntos distintos
        self.assertEqual(candidatos_k(9, 9), [])

    def test_metricas_no_disponibles_con_un_solo_grupo(self):
        X = np.array([[1, 1, 10], [2, 1, 12], [300, 1, 5000], [310, 2, 5100]], dtype=float)
        pipe = ajustar(X, 2, 1)
        un_grupo = metricas(pipe, X[:2])
        self.assertIsNone(un_grupo["silhouette"])
        self.assertIsNone(un_grupo["davies_bouldin"])
        self.assertIsNotNone(un_grupo["motivo_no_disponible"])
        self.assertIsNotNone(metricas(pipe, X)["silhouette"])


class EntrenamientoTest(unittest.TestCase):
    def test_entrena_y_ajusta_solo_con_entrenamiento(self):
        with tempfile.TemporaryDirectory() as tmp:
            res = entrenar_tienda(tienda_variada(90), Path(tmp), semilla=5)
            self.assertEqual(res["estado"], "listo")
            dv = res["division"]
            self.assertEqual((dv["total"], dv["entrenamiento"], dv["evaluacion"]), (90, 72, 18))
            asig = pd.read_csv(Path(tmp) / "asignaciones.csv")
            self.assertEqual(len(asig), 90)
            self.assertTrue(asig["cliente_id"].is_unique)
            pipe = cargar_modelo_confiable(Path(tmp) / "modelo.joblib", res["modelo"]["sha256"])
            ent = asig[asig["conjunto"] == "entrenamiento"][["recencia_dias", "frecuencia", "monto"]].to_numpy(float)
            todos = asig[["recencia_dias", "frecuencia", "monto"]].to_numpy(float)
            escalador = pipe.named_steps["escalado"]
            np.testing.assert_allclose(escalador.mean_, np.log1p(ent).mean(axis=0))
            self.assertFalse(np.allclose(escalador.mean_, np.log1p(todos).mean(axis=0)))
            self.assertEqual(pipe.named_steps["kmeans"].n_clusters, res["modelo"]["k"])
            self.assertEqual(sum(g["clientes"] for g in res["grupos"]), 90)
            self.assertEqual(sorted(g["grupo"] for g in res["grupos"]), list(range(1, len(res["grupos"]) + 1)))
            self.assertIsNotNone(res["metricas"]["evaluacion"]["silhouette"])
            self.assertTrue(all(r["k"] >= 2 for r in res["seleccion_k"]["resultados"]))

    def test_reproducible(self):
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            ra = entrenar_tienda(tienda_variada(60), Path(a), semilla=3)
            rb = entrenar_tienda(tienda_variada(60), Path(b), semilla=3)
            for clave in ("division", "seleccion_k", "metricas", "grupos"):
                self.assertEqual(ra[clave], rb[clave])
            self.assertEqual(ra["modelo"]["k"], rb["modelo"]["k"])

    def test_pocos_clientes_datos_insuficientes(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "modelo.joblib").write_bytes(b"viejo")
            res = entrenar_tienda(tienda_variada(reglas.MIN_CLIENTES - 1), Path(tmp))
            self.assertEqual((res["estado"], res["codigo_motivo"]), ("datos_insuficientes", "pocos_clientes"))
            self.assertEqual(res["grupos"], [])
            self.assertNotIn("metricas", res)
            self.assertFalse((Path(tmp) / "modelo.joblib").exists())  # no queda un modelo viejo
            self.assertEqual(json.loads((Path(tmp) / "resultado.json").read_text(encoding="utf-8"))["estado"], "datos_insuficientes")

    def test_filas_identicas_datos_insuficientes(self):
        with tempfile.TemporaryDirectory() as tmp:
            res = entrenar_tienda(tienda_variada(80, identicos=True), Path(tmp))
            self.assertEqual((res["estado"], res["codigo_motivo"]), ("datos_insuficientes", "poca_diversidad"))
            self.assertEqual(res["diversidad_entrenamiento"]["puntos_distintos"], 1)

    def test_modelo_alterado_no_se_carga(self):
        with tempfile.TemporaryDirectory() as tmp:
            res = entrenar_tienda(tienda_variada(60), Path(tmp))
            ruta = Path(tmp) / "modelo.joblib"
            ruta.write_bytes(ruta.read_bytes() + b"x")
            with self.assertRaises(ValueError):
                cargar_modelo_confiable(ruta, res["modelo"]["sha256"])


if __name__ == "__main__":
    unittest.main()
