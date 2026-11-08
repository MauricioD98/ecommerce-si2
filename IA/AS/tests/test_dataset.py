import json
import tempfile
import unittest
from pathlib import Path

import pandas as pd

from pronostico_ventas import reglas
from pronostico_ventas.datos import ErrorEntrada, cargar_carpeta
from pronostico_ventas.dataset import construir_dataset, semana_de, ultima_semana_completa
from tests.ayudantes import lunes, serie_semanal, tienda


class SemanasTest(unittest.TestCase):
    def test_semana_lunes_a_domingo_utc(self):
        fechas = pd.Series(pd.to_datetime(["2026-01-11T23:59:59Z", "2026-01-12T00:00:00Z", "2026-01-07T10:00:00Z"], utc=True))
        semanas = semana_de(fechas).dt.strftime("%Y-%m-%d").tolist()
        self.assertEqual(semanas, ["2026-01-05", "2026-01-12", "2026-01-05"])

    def test_ultima_semana_completa(self):
        # Corte un miércoles: la semana en curso no está completa
        self.assertEqual(ultima_semana_completa(pd.Timestamp("2026-01-14T15:00:00Z")), pd.Timestamp("2026-01-05"))
        # Corte exactamente el lunes 00:00: la semana anterior ya terminó
        self.assertEqual(ultima_semana_completa(pd.Timestamp("2026-01-12T00:00:00Z")), pd.Timestamp("2026-01-05"))


class ReglasVentasTest(unittest.TestCase):
    def test_estados_validos_cancelados_y_pendientes(self):
        lineas = [
            (lunes(0) + pd.Timedelta(days=1), "ENTREGADO", "S1", "A", "M", 2),
            (lunes(0) + pd.Timedelta(days=1), "ENVIADO", "S1", "A", "M", 1),
            (lunes(0) + pd.Timedelta(days=1), "PROCESANDO", "S1", "A", "M", 1),
            (lunes(0) + pd.Timedelta(days=2), "CANCELADO", "S1", "A", "M", 5),
            (lunes(0) + pd.Timedelta(days=3), "PENDIENTE", "S1", "A", "M", 7),
        ]
        ds = construir_dataset(tienda(lineas, corte_semana=2))
        fila = ds.panel[(ds.panel["semana"] == lunes(0).tz_localize(None)) & ~ds.panel["es_futura"]]
        self.assertEqual(fila["unidades"].tolist(), [4.0])
        self.assertEqual(ds.resumen["unidades_validas"], 4)
        self.assertEqual(ds.resumen["unidades_por_estado"]["CANCELADO"], 5)

    def test_devoluciones_no_se_restan_y_se_informan(self):
        lineas = serie_semanal([3, 3, 3])
        dev = [(lunes(1) + pd.Timedelta(days=4), "S1", "A", "M", 2)]
        ds = construir_dataset(tienda(lineas, dev, corte_semana=3))
        obs = ds.panel[~ds.panel["es_futura"]]
        self.assertEqual(obs["unidades"].tolist(), [3.0, 3.0, 3.0])
        self.assertEqual(obs["unidades_devueltas"].tolist(), [0, 2, 0])

    def test_semana_incompleta_descartada(self):
        lineas = serie_semanal([1, 1, 1]) + [(lunes(3) + pd.Timedelta(days=1), "ENTREGADO", "S1", "A", "M", 9)]
        datos = tienda(lineas)
        datos.corte = lunes(3) + pd.Timedelta(days=2)  # miércoles de la semana 3
        ds = construir_dataset(datos)
        self.assertEqual(ds.ultima_semana, lunes(2).tz_localize(None))
        self.assertEqual(ds.resumen["lineas_semana_incompleta_descartadas"], 1)
        self.assertNotIn(9.0, ds.panel["unidades"].tolist())

    def test_cero_observado_vs_semana_desconocida(self):
        # Primera línea en la semana 3: las semanas 0-2 son desconocidas (no se rellenan con 0)
        lineas = serie_semanal([2, 0, 0, 1], desde=3)
        ds = construir_dataset(tienda(lineas, corte_semana=8))
        obs = ds.panel[~ds.panel["es_futura"]]
        self.assertEqual(obs["semana"].min(), lunes(3).tz_localize(None))
        self.assertEqual(len(obs), 5)  # semanas 3..7
        self.assertEqual(obs["unidades"].tolist(), [2.0, 0.0, 0.0, 1.0, 0.0])

    def test_producto_inactivo_termina_en_su_ultima_linea(self):
        prods = pd.DataFrame([{"tienda_id": "t1", "producto_id": "A", "nombre": "A", "categoria": "X",
                               "creado_en": lunes(0), "activo": False}])
        ds = construir_dataset(tienda(serie_semanal([1, 1, 1]), productos=prods, corte_semana=10))
        self.assertEqual(ds.panel["semana"].max(), lunes(2).tz_localize(None))
        self.assertEqual(len(ds.futuras), 0)  # no se pronostica un producto inactivo

    def test_sin_talla_y_sin_sucursal(self):
        lineas = [(lunes(0) + pd.Timedelta(days=1), "ENTREGADO", reglas.SIN_SUCURSAL, "A", reglas.TALLA_UNICA, 1)]
        ds = construir_dataset(tienda(lineas, corte_semana=1))
        self.assertEqual(ds.panel["sucursal_nombre"].iloc[0], "Sin sucursal (web)")

    def test_variables_no_usan_informacion_futura(self):
        base = [5, 1, 4, 2, 6, 3, 7, 2, 1, 4]
        alterada = base[:6] + [99, 99, 99, 99]  # cambia solo desde la semana 6
        ds1 = construir_dataset(tienda(serie_semanal(base), corte_semana=10))
        ds2 = construir_dataset(tienda(serie_semanal(alterada), corte_semana=10))
        cols = ["u_lag1", "u_sum2", "u_sum4", "u_prom8", "semanas_historial", "sucursal_lag1", "tienda_lag1"]
        hasta6 = lambda ds: ds.panel[ds.panel["semana"] <= lunes(6).tz_localize(None)][cols].reset_index(drop=True)
        pd.testing.assert_frame_equal(hasta6(ds1), hasta6(ds2))
        fila = ds1.panel[ds1.panel["semana"] == lunes(4).tz_localize(None)].iloc[0]
        self.assertEqual((fila.u_lag1, fila.u_sum2, fila.u_sum4), (2.0, 6.0, 12.0))

    def test_elegibles_requieren_cuatro_semanas_de_historial(self):
        ds = construir_dataset(tienda(serie_semanal([1] * 6), corte_semana=6))
        self.assertEqual(sorted(ds.elegibles["semana"].dt.strftime("%Y-%m-%d")), ["2026-02-02", "2026-02-09"])


class CargaCarpetaTest(unittest.TestCase):
    def _escribir(self, carpeta: Path, tienda_en_ventas="t1"):
        (carpeta / "origen.json").write_text(json.dumps({"origen": "real", "tienda_id": "t1", "corte": "2026-02-02T00:00:00Z"}), encoding="utf-8")
        (carpeta / "ventas.csv").write_text(
            "tienda_id,pedido_id,fecha,estado,sucursal_id,producto_id,talla,unidades\n"
            f"{tienda_en_ventas},p1,2026-01-06T10:00:00.000Z,ENTREGADO,S1,A,,2\n", encoding="utf-8")
        (carpeta / "devoluciones.csv").write_text("tienda_id,fecha,sucursal_id,producto_id,talla,unidades\n", encoding="utf-8")
        (carpeta / "productos.csv").write_text("tienda_id,producto_id,nombre,categoria,creado_en,activo\nt1,A,A,X,2026-01-01T00:00:00Z,true\n", encoding="utf-8")
        (carpeta / "sucursales.csv").write_text("tienda_id,sucursal_id,nombre,creada_en,activa\nt1,S1,S,2026-01-01T00:00:00Z,true\n", encoding="utf-8")

    def test_carga_valida(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._escribir(Path(tmp))
            datos = cargar_carpeta(tmp)
            self.assertEqual(datos.origen, "real")
            self.assertEqual(datos.ventas["talla"].tolist(), [reglas.TALLA_UNICA])

    def test_rechaza_mezcla_de_tiendas(self):
        with tempfile.TemporaryDirectory() as tmp:
            self._escribir(Path(tmp), tienda_en_ventas="otra")
            with self.assertRaises(ErrorEntrada):
                cargar_carpeta(tmp)


if __name__ == "__main__":
    unittest.main()
