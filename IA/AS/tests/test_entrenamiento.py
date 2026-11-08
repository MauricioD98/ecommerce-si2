import json
import tempfile
import unittest
from pathlib import Path

import pandas as pd

from pronostico_ventas.cli import main
from pronostico_ventas.datos import cargar_carpeta
from pronostico_ventas.entrenamiento import entrenar_tienda
from pronostico_ventas.simulacion import TIENDAS_DEMO, generar_tienda, eliminar_simulacion
from tests.ayudantes import serie_semanal, tienda


class TiendaNuevaTest(unittest.TestCase):
    def test_tienda_con_poco_historial_datos_insuficientes(self):
        with tempfile.TemporaryDirectory() as tmp:
            res = entrenar_tienda(tienda(serie_semanal([1, 2, 1, 3, 2, 1])), Path(tmp))
            self.assertEqual(res["estado"], "datos_insuficientes")
            self.assertNotIn("metricas_prueba", res)
            self.assertFalse((Path(tmp) / "modelo.joblib").exists())
            metodos = {f["metodo"] for f in res["pronostico"]}
            self.assertNotIn("modelo", metodos)  # la alternativa nunca se atribuye al modelo


    def test_tienda_con_ventas_solo_en_la_semana_en_curso(self):
        # Corte un sábado y todas las ventas en esa semana incompleta: no hay ninguna semana completa
        datos = tienda(serie_semanal([3], desde=5), corte_semana=5)
        datos.corte = datos.corte + pd.Timedelta(days=5)
        with tempfile.TemporaryDirectory() as tmp:
            res = entrenar_tienda(datos, Path(tmp))
        self.assertEqual(res["estado"], "datos_insuficientes")
        self.assertEqual(res["datos"]["lineas_semana_incompleta_descartadas"], 1)
        self.assertEqual(res["datos"]["series"], 0)
        # Los productos activos sin semanas completas aparecen como datos insuficientes
        self.assertTrue(all(f["metodo"] == "datos_insuficientes" for f in res["pronostico"]))


class RecorridoSimuladoTest(unittest.TestCase):
    """Recorrido completo con una tienda simulada (más chica para que la prueba sea rápida)."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        base = Path(cls.tmp.name)
        cls.entrada = base / "entrada"
        generar_tienda("prueba_x", "Prueba X", cls.entrada, 123, sucursales=[("Uno", 1.0)], n_productos=11, escala=0.8)
        cls.res = entrenar_tienda(cargar_carpeta(cls.entrada), base / "salida", 5)
        cls.salida = base / "salida"

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_listo_con_80_20_por_semanas(self):
        r = self.res
        self.assertEqual(r["estado"], "listo")
        self.assertEqual(r["origen"], "simulado")
        self.assertGreaterEqual(r["division"]["semanas_objetivo"], 100)
        ent, pru = r["division"]["entrenamiento"], r["division"]["prueba"]
        self.assertEqual(ent["semanas"], r["division"]["semanas_objetivo"] * 8 // 10)
        self.assertLess(pd.Timestamp(ent["hasta"]), pd.Timestamp(pru["desde"]))
        self.assertEqual((pd.Timestamp(pru["desde"]) - pd.Timestamp(ent["hasta"])).days, 1)

    def test_metricas_coinciden_con_dataset(self):
        ds = pd.read_csv(self.salida / "dataset.csv")
        prueba = ds[ds["conjunto"] == "prueba"]
        self.assertEqual(len(prueba), self.res["metricas_prueba"]["filas"])
        mae_base = (prueba["unidades"] - prueba["u_sum4"] / 4).abs().mean()
        self.assertAlmostEqual(mae_base, self.res["metricas_prueba"]["mae_linea_base_promedio_4_semanas"], places=3)

    def test_pronostico_metodos_y_valores(self):
        filas = self.res["pronostico"]
        metodos = {f["metodo"] for f in filas}
        self.assertEqual(metodos, {"modelo", "alternativa_promedio", "datos_insuficientes"})
        for f in filas:
            if f["unidades_previstas"] is not None:
                self.assertGreaterEqual(f["unidades_previstas"], 0)
        self.assertEqual(self.res["periodo_pronosticado"], {"desde": "2026-11-02", "hasta": "2026-11-08"})
        self.assertEqual(self.res["corte_datos"], "2026-11-01")

    def test_reproducible(self):
        with tempfile.TemporaryDirectory() as tmp:
            otro = entrenar_tienda(cargar_carpeta(self.entrada), Path(tmp), 5)
        self.assertEqual(otro["metricas_prueba"], self.res["metricas_prueba"])
        self.assertEqual(otro["pronostico"], self.res["pronostico"])

    def test_sin_datos_personales_en_salidas(self):
        ds = pd.read_csv(self.salida / "dataset.csv", nrows=1)
        prohibidas = {"email", "user_id", "userId", "cliente", "direccion", "password", "token", "tarjeta"}
        self.assertFalse(prohibidas & set(ds.columns))


class SimulacionTest(unittest.TestCase):
    def test_reproducible_y_tiendas_separadas(self):
        with tempfile.TemporaryDirectory() as tmp:
            a1, a2, b = Path(tmp, "a1"), Path(tmp, "a2"), Path(tmp, "b")
            cfg = TIENDAS_DEMO["demo_tienda_b"]
            generar_tienda("demo_tienda_b", "B", a1, 99, cfg["sucursales"], cfg["productos"], cfg["escala"])
            generar_tienda("demo_tienda_b", "B", a2, 99, cfg["sucursales"], cfg["productos"], cfg["escala"])
            generar_tienda("demo_tienda_a", "A", b, 99, cfg["sucursales"], cfg["productos"], cfg["escala"])
            self.assertEqual((a1 / "ventas.csv").read_bytes(), (a2 / "ventas.csv").read_bytes())
            va = pd.read_csv(a1 / "ventas.csv", dtype=str)
            vb = pd.read_csv(b / "ventas.csv", dtype=str)
            self.assertEqual(set(va["tienda_id"]), {"demo_tienda_b"})
            self.assertFalse(set(va["producto_id"]) & set(vb["producto_id"]))
            self.assertEqual(json.loads((a1 / "origen.json").read_text(encoding="utf-8"))["origen"], "simulado")

    def test_limpiar_solo_borra_carpetas_simuladas(self):
        with tempfile.TemporaryDirectory() as tmp:
            sim = Path(tmp, "sim")
            generar_tienda("t", "T", sim, 1, [("Uno", 1.0)], 3, 0.2)
            real = Path(tmp, "real")
            real.mkdir()
            (real / "origen.json").write_text('{"origen": "real", "tienda_id": "x"}', encoding="utf-8")
            (real / "DATOS_SIMULADOS.txt").write_text("marca falsa", encoding="utf-8")
            self.assertFalse(eliminar_simulacion(real))
            self.assertTrue(real.exists())
            self.assertEqual(main(["limpiar-demo", tmp]), 0)
            self.assertFalse(sim.exists())
            self.assertTrue(real.exists())


if __name__ == "__main__":
    unittest.main()
