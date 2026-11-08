import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from pronostico_ventas.dataset import COLUMNAS_CATEGORICAS, COLUMNAS_NUMERICAS
from pronostico_ventas.modelo import (
    cargar_modelo_confiable,
    crear_pipeline,
    dividir_80_20,
    guardar_modelo,
    linea_base_promedio4,
    mae,
    predecir,
)


def filas_sinteticas(n_semanas=30, categorias=("Blusas", "Jeans"), semilla=0):
    rng = np.random.default_rng(semilla)
    filas = []
    for k in range(n_semanas):
        for cat in categorias:
            lag = float(rng.integers(0, 6))
            filas.append({
                "semana": pd.Timestamp("2026-01-05") + pd.Timedelta(weeks=k), "categoria": cat,
                "sucursal_id": "S1", "talla": "M", "u_lag1": lag, "u_sum2": lag * 2, "u_sum4": lag * 4,
                "u_prom8": lag, "semanas_historial": 10.0, "sucursal_lag1": 10.0, "tienda_lag1": 20.0,
                "sem_sin": 0.0, "sem_cos": 1.0, "mes": 1.0, "unidades": lag + float(rng.integers(0, 2)),
            })
    return pd.DataFrame(filas)


class DivisionTest(unittest.TestCase):
    def test_cien_semanas_80_20(self):
        semanas = [pd.Timestamp("2024-01-01") + pd.Timedelta(weeks=k) for k in range(100)]
        d = dividir_80_20(semanas)
        self.assertEqual((len(d.semanas_entrenamiento), len(d.semanas_prueba)), (80, 20))
        self.assertLess(max(d.semanas_entrenamiento), min(d.semanas_prueba))
        self.assertLessEqual(max(d.semanas_entrenamiento) + pd.Timedelta(days=7), d.primera_semana_prueba)

    def test_redondeo_documentado(self):
        for n, esperado in [(113, (90, 23)), (10, (8, 2)), (101, (80, 21))]:
            semanas = [pd.Timestamp("2024-01-01") + pd.Timedelta(weeks=k) for k in range(n)]
            d = dividir_80_20(semanas)
            self.assertEqual((len(d.semanas_entrenamiento), len(d.semanas_prueba)), esperado)

    def test_misma_semana_mismo_lado_aunque_haya_muchas_filas(self):
        df = filas_sinteticas(20, categorias=("A", "B", "C"))
        d = dividir_80_20(df["semana"])  # semanas repetidas: se divide por semana, no por fila
        lado = df["semana"].isin(d.semanas_entrenamiento)
        self.assertTrue((df.groupby("semana")["semana"].transform(lambda s: lado[s.index].nunique()) == 1).all())
        self.assertEqual(int(lado.sum()), 16 * 3)

    def test_rechaza_pocas_semanas(self):
        with self.assertRaises(ValueError):
            dividir_80_20([pd.Timestamp("2024-01-01")])


class PipelineTest(unittest.TestCase):
    def test_preprocesamiento_ajustado_solo_con_entrenamiento_y_categoria_desconocida(self):
        entrenamiento = filas_sinteticas(20)
        prueba = filas_sinteticas(2, categorias=("Categoria Nueva",), semilla=1)
        pipe = crear_pipeline(7).fit(entrenamiento, entrenamiento["unidades"])
        categorias = pipe.named_steps["preprocesamiento"].named_transformers_["categoricas"].categories_[0]
        self.assertEqual(sorted(categorias), ["Blusas", "Jeans"])
        pred = predecir(pipe, prueba)  # no falla: la categoría desconocida se codifica como ceros
        self.assertEqual(len(pred), 2)
        self.assertTrue((pred >= 0).all())

    def test_reproducible_con_semilla(self):
        df = filas_sinteticas(25)
        p1 = predecir(crear_pipeline(42).fit(df, df["unidades"]), df)
        p2 = predecir(crear_pipeline(42).fit(df, df["unidades"]), df)
        np.testing.assert_array_equal(p1, p2)

    def test_mae_y_linea_base(self):
        self.assertAlmostEqual(mae([1, 2, 3], [2, 2, 5]), 1.0)
        filas = pd.DataFrame({"u_sum4": [8.0, 2.0], "u_lag1": [1.0, 0.0]})
        np.testing.assert_array_equal(linea_base_promedio4(filas), [2.0, 0.5])

    def test_variables_esperadas(self):
        self.assertEqual(COLUMNAS_CATEGORICAS, ["categoria", "sucursal_id", "talla"])
        self.assertIn("u_sum4", COLUMNAS_NUMERICAS)
        self.assertNotIn("unidades", COLUMNAS_NUMERICAS)

    def test_modelo_alterado_no_se_carga(self):
        df = filas_sinteticas(10)
        pipe = crear_pipeline(1).fit(df, df["unidades"])
        with tempfile.TemporaryDirectory() as tmp:
            ruta = Path(tmp) / "modelo.joblib"
            sha = guardar_modelo(pipe, ruta)
            recargado = cargar_modelo_confiable(ruta, sha)
            np.testing.assert_array_equal(predecir(recargado, df), predecir(pipe, df))
            with open(ruta, "ab") as f:
                f.write(b"x")
            with self.assertRaises(ValueError):
                cargar_modelo_confiable(ruta, sha)


if __name__ == "__main__":
    unittest.main()
