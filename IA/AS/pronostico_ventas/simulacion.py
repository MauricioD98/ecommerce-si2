"""Generador reproducible de ventas SIMULADAS (solo para demostración).

  * Semilla fija; sin clientes ni datos personales; tiendas, sucursales y productos ficticios.
  * Fechas fijas (no dependen del día en que se corre): 117 semanas, del lunes 2024-08-05 al
    domingo 2026-11-01. Corte de la extracción simulada: 2026-11-02 00:00 UTC.
  * Incluye pedidos cancelados y pendientes, devoluciones, un producto lanzado a mitad del periodo,
    uno lanzado hace 2 semanas (historial escaso), uno sin ventas y uno discontinuado.
  * No toca ninguna base de datos ni Stripe: solo escribe CSV/JSON en la carpeta indicada.
"""
from __future__ import annotations

import json
import shutil
import zlib
from pathlib import Path

import numpy as np
import pandas as pd

from . import reglas

INICIO = pd.Timestamp("2024-08-05")  # lunes
N_SEMANAS = 117
CORTE = pd.Timestamp("2026-11-02T00:00:00Z")
MARCA = "DATOS_SIMULADOS.txt"
AVISO = "DATOS SIMULADOS - generados por pronostico_ventas.simulacion para demostración. No son ventas reales."

# (nombre, categoría, tallas, ventas base por semana y talla en la sucursal principal, semana de
#  lanzamiento, activo). Las tallas "UNICA" se exportan vacías, como en la base real.
CATALOGO = [
    ("Blusa Lino Demo", "Blusas", ["S", "M", "L"], 3.0, 0, True),
    ("Blusa Seda Demo", "Blusas", ["S", "M", "L"], 1.8, 0, True),
    ("Pantalón Palazzo Demo", "Pantalones", ["S", "M", "L", "XL"], 2.2, 0, True),
    ("Jean Recto Demo", "Pantalones", ["S", "M", "L", "XL"], 2.6, 0, True),
    ("Vestido Floral Demo", "Vestidos", ["S", "M", "L"], 2.0, 0, True),
    ("Abrigo Paño Demo", "Abrigos", ["M", "L"], 1.2, 0, True),
    ("Cartera Cuero Demo", "Accesorios", [""], 2.5, 0, True),
    ("Top Temporada Demo", "Blusas", ["S", "M"], 2.4, 60, True),  # lanzado a mitad del periodo
    ("Falda Cápsula Demo", "Vestidos", ["S", "M"], 2.0, 115, True),  # solo 2 semanas de historial
    ("Chaleco Discontinuado Demo", "Abrigos", ["M"], 1.5, 0, False),  # se deja de vender en la semana 80
    ("Bufanda Nueva Demo", "Accesorios", [""], 0.0, 999, True),  # creado, nunca vendido
]
SEMANA_BAJA_DISCONTINUADO = 80

TIENDAS_DEMO = {
    "demo_tienda_a": {"nombre": "Tienda Demo A (simulada)", "sucursales": [("Centro", 1.0), ("Norte", 0.7), ("Sur", 0.5)], "productos": 11, "escala": 1.0},
    "demo_tienda_b": {"nombre": "Tienda Demo B (simulada)", "sucursales": [("Plaza", 1.0), ("Este", 0.6)], "productos": 9, "escala": 0.6},
}


def semilla_de_tienda(semilla: int, tienda_id: str) -> int:
    """Semilla propia de cada tienda: reproducible y distinta entre tiendas."""
    return (semilla ^ zlib.crc32(tienda_id.encode("utf-8"))) & 0xFFFFFFFF


def _estacionalidad(categoria: str, semana: pd.Timestamp) -> float:
    dia_del_anio = semana.day_of_year
    factor = 1.0
    if categoria == "Abrigos":  # invierno del hemisferio sur (junio-agosto)
        factor *= 1.0 + 0.9 * np.exp(-((dia_del_anio - 196) ** 2) / (2 * 30.0**2))
    if categoria == "Vestidos":  # verano (diciembre-febrero)
        distancia = min(abs(dia_del_anio - 15), 365 - abs(dia_del_anio - 15))
        factor *= 1.0 + 0.6 * np.exp(-(distancia**2) / (2 * 35.0**2))
    if semana.month == 12:
        factor *= 1.35  # fiestas de fin de año
    if semana.month == 5 and semana.day >= 21:
        factor *= 1.3  # semana del Día de la Madre (27 de mayo en Bolivia)
    return factor


def generar_tienda(tienda_id: str, nombre: str, carpeta: Path, semilla: int = reglas.SEMILLA_POR_DEFECTO,
                   sucursales=None, n_productos: int = len(CATALOGO), escala: float = 1.0) -> dict:
    sucursales = sucursales or TIENDAS_DEMO["demo_tienda_a"]["sucursales"]
    rng = np.random.default_rng(semilla_de_tienda(semilla, tienda_id))
    carpeta.mkdir(parents=True, exist_ok=True)
    prefijo = tienda_id

    filas_suc = [
        {"tienda_id": tienda_id, "sucursal_id": f"{prefijo}-suc-{i + 1}", "nombre": f"Sucursal Demo {n}",
         "creada_en": INICIO.isoformat() + "Z", "activa": "true", "factor": f}
        for i, (n, f) in enumerate(sucursales)
    ]
    catalogo = CATALOGO[:n_productos] if n_productos >= len(CATALOGO) else CATALOGO[: n_productos - 1] + [CATALOGO[-1]]
    filas_prod = []
    for j, (pnombre, cat, tallas, base, lanzamiento, activo) in enumerate(catalogo):
        creado = INICIO + pd.Timedelta(weeks=min(lanzamiento, N_SEMANAS - 1))
        filas_prod.append({
            "tienda_id": tienda_id, "producto_id": f"{prefijo}-prod-{j + 1:02d}", "nombre": pnombre,
            "categoria": cat, "creado_en": creado.isoformat() + "Z", "activo": "true" if activo else "false",
            "_tallas": tallas, "_base": base * escala * rng.uniform(0.8, 1.2), "_lanzamiento": lanzamiento,
            "_activo": activo,
        })

    semanas = [INICIO + pd.Timedelta(weeks=k) for k in range(N_SEMANAS)]
    ventas, devoluciones = [], []
    pedido = 0
    for suc in filas_suc:
        for prod in filas_prod:
            if prod["_base"] <= 0:
                continue
            nivel_serie = rng.uniform(0.75, 1.25)
            for talla in prod["_tallas"]:
                peso_talla = {"S": 0.8, "M": 1.2, "L": 1.0, "XL": 0.6, "": 1.0}[talla]
                for k, semana in enumerate(semanas):
                    if k < prod["_lanzamiento"]:
                        continue
                    if not prod["_activo"] and k > SEMANA_BAJA_DISCONTINUADO:
                        continue
                    tendencia = 1.0 + 0.10 * k / 52
                    lam = (prod["_base"] * suc["factor"] * peso_talla * nivel_serie * tendencia
                           * _estacionalidad(prod["categoria"], semana) * rng.lognormal(0.0, 0.15))
                    restantes = int(rng.poisson(lam))
                    while restantes > 0:
                        cantidad = int(min(restantes, rng.choice([1, 1, 1, 2, 2, 3])))
                        restantes -= cantidad
                        pedido += 1
                        fecha = semana + pd.Timedelta(days=int(rng.integers(0, 7)), hours=int(rng.integers(9, 21)), minutes=int(rng.integers(0, 60)))
                        estado = rng.choice(["ENTREGADO", "ENVIADO", "PROCESANDO"], p=[0.85, 0.08, 0.07])
                        ventas.append(_linea(tienda_id, pedido, fecha, estado, suc, prod, talla, cantidad))
                        if rng.random() < 0.04:
                            fecha_dev = fecha + pd.Timedelta(days=int(rng.integers(3, 21)))
                            if fecha_dev.tz_localize("UTC") < CORTE:
                                devoluciones.append({
                                    "tienda_id": tienda_id, "fecha": fecha_dev.isoformat() + "Z",
                                    "sucursal_id": suc["sucursal_id"], "producto_id": prod["producto_id"],
                                    "talla": talla, "unidades": int(rng.integers(1, cantidad + 1)),
                                })
                    # Pedidos que NO cuentan: cancelados (en cualquier semana) y pendientes (recientes)
                    if rng.random() < 0.08:
                        pedido += 1
                        ventas.append(_linea(tienda_id, pedido, semana + pd.Timedelta(days=int(rng.integers(0, 7)), hours=12),
                                             "CANCELADO", suc, prod, talla, int(rng.integers(1, 3))))
                    if k >= N_SEMANAS - 2 and rng.random() < 0.1:
                        pedido += 1
                        ventas.append(_linea(tienda_id, pedido, semana + pd.Timedelta(days=2, hours=15),
                                             "PENDIENTE", suc, prod, talla, 1))

    _csv(carpeta / "sucursales.csv", [{k: v for k, v in s.items() if k != "factor"} for s in filas_suc])
    _csv(carpeta / "productos.csv", [{k: v for k, v in p.items() if not k.startswith("_")} for p in filas_prod])
    _csv(carpeta / "ventas.csv", ventas, ["tienda_id", "pedido_id", "fecha", "estado", "sucursal_id", "producto_id", "talla", "unidades"])
    _csv(carpeta / "devoluciones.csv", devoluciones, ["tienda_id", "fecha", "sucursal_id", "producto_id", "talla", "unidades"])
    origen = {
        "origen": "simulado", "tienda_id": tienda_id, "tienda_nombre": nombre,
        "corte": CORTE.isoformat(), "semilla": semilla, "aviso": AVISO,
    }
    (carpeta / "origen.json").write_text(json.dumps(origen, ensure_ascii=False, indent=2), encoding="utf-8")
    (carpeta / MARCA).write_text(AVISO + "\n", encoding="utf-8")
    return {"tienda_id": tienda_id, "carpeta": str(carpeta), "lineas": len(ventas), "devoluciones": len(devoluciones)}


def _linea(tienda_id, pedido, fecha, estado, suc, prod, talla, cantidad) -> dict:
    return {
        "tienda_id": tienda_id, "pedido_id": f"sim-{pedido:07d}", "fecha": fecha.isoformat() + "Z",
        "estado": str(estado), "sucursal_id": suc["sucursal_id"], "producto_id": prod["producto_id"],
        "talla": talla, "unidades": cantidad,
    }


def _csv(ruta: Path, filas: list[dict], columnas: list[str] | None = None) -> None:
    pd.DataFrame(filas, columns=columnas).to_csv(ruta, index=False)


def generar_demo(carpeta_base: Path, semilla: int = reglas.SEMILLA_POR_DEFECTO) -> list[dict]:
    """Las dos tiendas ficticias, cada una en su propia subcarpeta."""
    return [
        generar_tienda(tid, cfg["nombre"], carpeta_base / tid, semilla, cfg["sucursales"], cfg["productos"], cfg["escala"])
        for tid, cfg in TIENDAS_DEMO.items()
    ]


def es_carpeta_simulada(carpeta: Path) -> bool:
    origen = carpeta / "origen.json"
    if not (carpeta / MARCA).is_file() or not origen.is_file():
        return False
    try:
        return json.loads(origen.read_text(encoding="utf-8")).get("origen") == "simulado"
    except (ValueError, OSError):
        return False


def eliminar_simulacion(carpeta: Path) -> bool:
    """Borra la carpeta solo si está marcada como simulada (nunca datos reales)."""
    if not es_carpeta_simulada(carpeta):
        return False
    shutil.rmtree(carpeta)
    return True
