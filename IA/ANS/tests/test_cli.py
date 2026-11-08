import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from segmentacion_clientes.cli import main
from segmentacion_clientes.datos import cargar_carpeta
from segmentacion_clientes.simulacion import TIENDAS_DEMO


def correr(*args) -> int:
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        return main(list(args))


class RecorridoDemoTest(unittest.TestCase):
    """generar datos -> RFM -> dividir por cliente -> entrenar -> evaluar -> mostrar -> visualizar -> limpiar."""

    def test_recorrido_completo(self):
        with tempfile.TemporaryDirectory() as tmp:
            datos, salidas = Path(tmp, "datos_demo"), Path(tmp, "salidas")
            self.assertEqual(correr("simular", "--salida", str(datos)), 0)
            for tienda in TIENDAS_DEMO:
                d = cargar_carpeta(datos / tienda)
                self.assertEqual(d.origen, "simulado")
                self.assertEqual(set(d.pedidos["tienda_id"]), {tienda})  # cada carpeta, una sola tienda
            # Misma semilla => mismos archivos
            otra = Path(tmp, "otra")
            correr("simular", "--salida", str(otra))
            self.assertEqual((datos / "demo_tienda_a" / "pedidos.csv").read_bytes(), (otra / "demo_tienda_a" / "pedidos.csv").read_bytes())

            salida = salidas / "demo_tienda_a"
            self.assertEqual(correr("entrenar", "--entrada", str(datos / "demo_tienda_a"), "--salida", str(salida)), 0)
            res = json.loads((salida / "resultado.json").read_text(encoding="utf-8"))
            self.assertEqual((res["estado"], res["origen"], res["tienda_id"]), ("listo", "simulado", "demo_tienda_a"))
            self.assertGreaterEqual(res["division"]["total"], 100)
            self.assertEqual(res["division"]["entrenamiento"], res["division"]["total"] * 8 // 10)
            self.assertTrue((salida / "DATOS_SIMULADOS.txt").is_file())
            self.assertEqual(correr("mostrar", "--salida", str(salida)), 0)
            self.assertEqual(correr("visualizar", "--salida", str(salida)), 0)
            self.assertIn("DATOS DE DEMOSTRACIÓN", (salida / "grupos.html").read_text(encoding="utf-8"))

            # Una carpeta "real" (sin marca) nunca se borra
            real = salidas / "real_tienda"
            real.mkdir()
            (real / "resultado.json").write_text(json.dumps({"origen": "real"}), encoding="utf-8")
            self.assertEqual(correr("limpiar-demo", str(datos), str(salidas), str(otra)), 0)
            self.assertFalse((datos / "demo_tienda_a").exists())
            self.assertFalse(salida.exists())
            self.assertTrue(real.is_dir())

    def test_codigos_de_salida(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(correr("entrenar", "--entrada", str(Path(tmp, "no_existe")), "--salida", str(Path(tmp, "s"))), 2)
            datos = Path(tmp, "d")
            correr("simular", "--salida", str(datos), "--tienda-id", "t-x")
            # Periodo de 3 días: casi nadie compró -> datos insuficientes
            self.assertEqual(correr("entrenar", "--entrada", str(datos), "--salida", str(Path(tmp, "s")), "--periodo-dias", "3"), 3)
            self.assertEqual(correr("mostrar", "--salida", str(Path(tmp, "vacia"))), 2)


if __name__ == "__main__":
    unittest.main()
