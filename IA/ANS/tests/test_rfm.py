import unittest

import pandas as pd

from segmentacion_clientes.datos import ErrorEntrada
from segmentacion_clientes.rfm import construir_rfm
from tests.ayudantes import CORTE, hace, tienda


def fila(tabla, cliente):
    return tabla.rfm.set_index("cliente_id").loc[cliente]


class CalculoRFMTest(unittest.TestCase):
    def test_tres_variables(self):
        t = construir_rfm(tienda([
            ("p1", "a", hace(40.5), "ENTREGADO", 100),
            ("p2", "a", hace(10.5), "ENVIADO", 50.25),
            ("p3", "b", hace(3.2), "PROCESANDO", 20),
        ]))
        a = fila(t, "a")
        self.assertEqual(int(a.recencia_dias), 10)  # días completos hasta el corte
        self.assertEqual(int(a.frecuencia), 2)
        self.assertAlmostEqual(float(a.monto), 150.25)
        self.assertEqual(int(fila(t, "b").recencia_dias), 3)
        self.assertTrue(t.rfm["cliente_id"].is_unique)

    def test_limites_del_periodo_y_corte(self):
        inicio = CORTE - pd.Timedelta(days=365)
        datos = tienda([
            ("p1", "a", inicio.isoformat(), "ENTREGADO", 10),  # justo en el inicio: cuenta
            ("p2", "b", (inicio - pd.Timedelta(seconds=1)).isoformat(), "ENTREGADO", 10),  # antes: no
            ("p3", "c", CORTE.isoformat(), "ENTREGADO", 10),  # en el corte: excluido (posterior)
        ])
        t = construir_rfm(datos)
        self.assertEqual(sorted(t.rfm["cliente_id"]), ["a"])
        self.assertEqual(int(fila(t, "a").recencia_dias), 365)
        self.assertEqual(t.resumen["clientes"]["sin_compras_en_periodo"], 1)  # b
        self.assertEqual(t.resumen["pedidos"]["excluidos"]["posterior_al_corte"], 1)
        self.assertEqual(t.resumen["clientes"]["sin_compras_validas"], 1)  # c
        self.assertEqual(t.resumen["zona_horaria"], "UTC")

    def test_corte_configurable_ignora_lo_posterior(self):
        datos = tienda([("p1", "a", hace(5), "ENTREGADO", 10), ("p2", "a", hace(50), "ENTREGADO", 20)])
        t = construir_rfm(datos, corte=CORTE - pd.Timedelta(days=30), periodo_dias=90)
        self.assertEqual(int(fila(t, "a").frecuencia), 1)
        self.assertEqual(int(fila(t, "a").recencia_dias), 20)
        with self.assertRaises(ErrorEntrada):
            construir_rfm(datos, corte=CORTE + pd.Timedelta(days=1))

    def test_estados_pendiente_cancelado_y_devoluciones(self):
        datos = tienda(
            [
                ("p1", "a", hace(5), "ENTREGADO", 100),
                ("p2", "a", hace(6), "PENDIENTE", 999),
                ("p3", "a", hace(7), "CANCELADO", 999),
                ("p4", "b", hace(8), "CANCELADO", 50),
            ],
            clientes=["a", "b", "sin_pedidos"],
            devoluciones=[("p1", hace(2), 40)],
        )
        t = construir_rfm(datos)
        self.assertEqual(int(fila(t, "a").frecuencia), 1)
        self.assertAlmostEqual(float(fila(t, "a").monto), 100.0)  # bruto: la devolución no se resta
        self.assertEqual(t.resumen["devoluciones"]["pedidos_con_devolucion"], 1)
        self.assertAlmostEqual(t.resumen["devoluciones"]["monto_devuelto"], 40.0)
        c = t.resumen["clientes"]
        self.assertEqual((c["total"], c["elegibles"], c["sin_compras_validas"]), (3, 1, 2))
        self.assertEqual((t.resumen["pedidos"]["pendientes"], t.resumen["pedidos"]["cancelados"]), (1, 2))

    def test_duplicados_y_registros_problematicos(self):
        datos = tienda([
            ("p1", "a", hace(5), "ENTREGADO", 100),
            ("p1", "a", hace(5), "ENTREGADO", 100),  # duplicado exacto: se cuenta una vez
            ("p2", "a", hace(6), "ENTREGADO", 10),
            ("p2", "a", hace(6), "ENTREGADO", 70),  # mismo id, contenido distinto: se excluyen ambos
            ("p3", "", hace(5), "ENTREGADO", 10),
            ("p4", "a", "no-es-fecha", "ENTREGADO", 10),
            ("p5", "a", hace(5), "ENTREGADO", ""),
            ("p6", "a", hace(5), "ENTREGADO", -5),
            ("p7", "a", hace(5), "DESCONOCIDO", 5),
            ("", "a", hace(5), "ENTREGADO", 5),
        ])
        original = datos.pedidos.copy()
        t = construir_rfm(datos)
        self.assertEqual(int(fila(t, "a").frecuencia), 1)
        self.assertAlmostEqual(float(fila(t, "a").monto), 100.0)
        p = t.resumen["pedidos"]
        self.assertEqual(p["duplicados_exactos_descartados"], 1)
        self.assertEqual(p["excluidos"], {
            "sin_pedido_id": 1, "pedido_id_conflictivo": 2, "sin_cliente": 1, "fecha_invalida": 1,
            "monto_invalido": 1, "monto_negativo": 1, "estado_desconocido": 1, "posterior_al_corte": 0,
        })
        pd.testing.assert_frame_equal(datos.pedidos, original)  # los datos originales no se modifican

    def test_monto_extremo_se_conserva(self):
        pedidos = [(f"p{i}", f"c{i}", hace(10 + i), "ENTREGADO", 100 + i) for i in range(10)]
        pedidos.append(("px", "c0", hace(3), "ENTREGADO", 250000))
        t = construir_rfm(tienda(pedidos))
        self.assertAlmostEqual(float(fila(t, "c0").monto), 250100.0)
        self.assertEqual(t.resumen["montos"]["clientes_con_monto_extremo_informativo"], 1)


class ValidacionEntradaTest(unittest.TestCase):
    def test_no_mezcla_monedas(self):
        with self.assertRaises(ErrorEntrada):
            tienda([("p1", "a", hace(5), "ENTREGADO", 10, "BOB"), ("p2", "b", hace(5), "ENTREGADO", 10, "USD")])

    def test_no_mezcla_tiendas(self):
        datos = tienda([("p1", "a", hace(5), "ENTREGADO", 10)])
        datos.pedidos.loc[0, "tienda_id"] = "otra"
        from segmentacion_clientes.datos import validar
        with self.assertRaises(ErrorEntrada):
            validar(datos)


if __name__ == "__main__":
    unittest.main()
