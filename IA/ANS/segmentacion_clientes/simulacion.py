"""Generador reproducible de clientes y compras SIMULADOS (solo para demostración).

  * Semilla fija; clientes ficticios con identificadores seudónimos (sin nombres, correos ni teléfonos).
  * Fechas fijas (no dependen del día en que se corre): compras desde 2024-11-01; corte simulado
    2026-11-01 00:00 UTC. Moneda única: BOB.
  * Mezcla comportamientos de compra variados (sin escribir ninguna etiqueta: el modelo no las ve),
    clientes sin compras, clientes con compras solo antes del periodo, pedidos pendientes y cancelados,
    devoluciones y registros problemáticos (duplicados, fecha inválida, importe negativo, sin cliente,
    id de pedido repetido con datos distintos y un importe extremo) para ejercitar la limpieza.
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

CORTE = pd.Timestamp("2026-11-01T00:00:00Z")
INICIO_HISTORIA = pd.Timestamp("2024-11-01T00:00:00Z")
MONEDA = "BOB"
MARCA = "DATOS_SIMULADOS.txt"
AVISO = "DATOS SIMULADOS - generados por segmentacion_clientes.simulacion para demostración. No son clientes ni compras reales."

# Comportamientos latentes del generador: (peso, pedidos por año, ticket medio Bs, días desde la última
# compra [min, max], días de antigüedad [min, max]). Solo guían la simulación; no se guardan.
PERFILES = {
    "habitual": (0.22, (10, 18), 320, (1, 45), (300, 730)),
    "ocasional": (0.25, (3, 6), 230, (20, 150), (200, 730)),
    "reciente": (0.15, (1, 2), 170, (0, 50), (0, 60)),
    "alejado": (0.16, (1, 3), 210, (200, 360), (250, 730)),
    "ticket_alto": (0.07, (2, 4), 1900, (10, 180), (200, 730)),
    "solo_antes_del_periodo": (0.07, (2, 4), 250, (380, 600), (450, 730)),
    "sin_compras_validas": (0.08, (0, 0), 0, (0, 0), (0, 0)),
}

TIENDAS_DEMO = {
    "demo_tienda_a": {"nombre": "Tienda Demo A (simulada)", "clientes": 260, "escala_ticket": 1.0},
    "demo_tienda_b": {"nombre": "Tienda Demo B (simulada)", "clientes": 160, "escala_ticket": 0.7},
}


def semilla_de_tienda(semilla: int, tienda_id: str) -> int:
    """Semilla propia de cada tienda: reproducible y distinta entre tiendas."""
    return (semilla ^ zlib.crc32(tienda_id.encode("utf-8"))) & 0xFFFFFFFF


def _iso(ts: pd.Timestamp) -> str:
    return ts.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _estado(rng: np.random.Generator, fecha: pd.Timestamp) -> str:
    r = rng.random()
    if r < 0.04:
        return "CANCELADO"
    if r < 0.07:
        return "PENDIENTE"
    # Los pedidos recientes todavía pueden estar en camino
    if (CORTE - fecha).days < 10:
        return "PROCESANDO" if r < 0.5 else "ENVIADO"
    return "ENTREGADO"


def _simular(tienda_id: str, n_clientes: int, escala_ticket: float, semilla: int):
    rng = np.random.default_rng(semilla_de_tienda(semilla, tienda_id))
    prefijo = tienda_id[:8]
    nombres = list(PERFILES)
    pesos = np.array([PERFILES[p][0] for p in nombres])
    perfiles = rng.choice(nombres, size=n_clientes, p=pesos / pesos.sum())

    clientes, pedidos, devoluciones = [], [], []
    for i, perfil in enumerate(perfiles):
        cliente = f"{prefijo}-c{i + 1:04d}"
        _, por_anio, ticket, (ult_min, ult_max), (ant_min, ant_max) = PERFILES[perfil]
        if perfil == "sin_compras_validas":
            registro = CORTE - pd.Timedelta(days=int(rng.integers(5, 700)))
            clientes.append({"tienda_id": tienda_id, "cliente_id": cliente, "registrado_en": _iso(registro)})
            if rng.random() < 0.5:  # algunos dejaron un pedido pendiente o cancelado
                fecha = CORTE - pd.Timedelta(days=int(rng.integers(1, 300)), hours=int(rng.integers(0, 24)))
                pedidos.append([cliente, fecha, str(rng.choice(["PENDIENTE", "CANCELADO"])), round(float(rng.uniform(80, 400)), 2)])
            continue

        ultima = CORTE - pd.Timedelta(days=int(rng.integers(ult_min, ult_max + 1)), hours=int(rng.integers(1, 23)))
        primera = max(INICIO_HISTORIA, CORTE - pd.Timedelta(days=int(rng.integers(max(ant_min, ult_max), max(ant_max, ult_max + 1) + 1))))
        primera = min(primera, ultima)
        clientes.append({"tienda_id": tienda_id, "cliente_id": cliente, "registrado_en": _iso(primera - pd.Timedelta(days=int(rng.integers(0, 30))))})
        dias = max((ultima - primera).days, 0)
        n = max(1, int(round(rng.uniform(*por_anio) * max(dias, 30) / 365))) if dias > 0 else 1
        fechas = sorted({ultima} | {primera + pd.Timedelta(days=int(d), hours=int(rng.integers(8, 21))) for d in rng.integers(0, dias + 1, size=n - 1)})
        fechas = [f for f in fechas if f <= ultima]
        for fecha in fechas:
            monto = round(float(rng.lognormal(np.log(ticket * escala_ticket), 0.35)), 2)
            pedidos.append([cliente, fecha, _estado(rng, fecha), monto])
        # La última compra siempre es válida, así la recencia simulada es la buscada
        pedidos[-1][2] = "ENTREGADO" if (CORTE - ultima).days >= 10 else "PROCESANDO"

    pedidos.sort(key=lambda p: (p[1], p[0]))
    filas = []
    for j, (cliente, fecha, estado, monto) in enumerate(pedidos):
        pedido = f"{prefijo}-p{j + 1:06d}"
        filas.append({"tienda_id": tienda_id, "pedido_id": pedido, "cliente_id": cliente, "fecha": _iso(fecha),
                      "estado": estado, "monto": f"{monto:.2f}", "moneda": MONEDA})
        if estado == "ENTREGADO" and rng.random() < 0.05:
            fecha_dev = fecha + pd.Timedelta(days=int(rng.integers(3, 20)))
            if fecha_dev < CORTE:
                devoluciones.append({"tienda_id": tienda_id, "pedido_id": pedido, "fecha": _iso(fecha_dev),
                                     "monto": f"{monto * float(rng.uniform(0.3, 1.0)):.2f}"})
    filas = _agregar_registros_problematicos(filas, tienda_id, prefijo, clientes)
    return clientes, filas, devoluciones


def _agregar_registros_problematicos(filas: list[dict], tienda_id: str, prefijo: str, clientes: list[dict]) -> list[dict]:
    """Casos que la preparación debe excluir y contar (no deben romper el entrenamiento)."""
    base = {"tienda_id": tienda_id, "estado": "ENTREGADO", "moneda": MONEDA}
    alguno = clientes[0]["cliente_id"]
    extra = [
        dict(filas[5]), dict(filas[17]), dict(filas[42]),  # duplicados exactos (mismo pedido exportado dos veces)
        {**base, "pedido_id": f"{prefijo}-x1", "cliente_id": alguno, "fecha": "no-es-una-fecha", "monto": "120.00"},
        {**base, "pedido_id": f"{prefijo}-x2", "cliente_id": alguno, "fecha": "2026-06-10T15:00:00.000Z", "monto": "-50.00"},
        {**base, "pedido_id": f"{prefijo}-x3", "cliente_id": "", "fecha": "2026-06-11T15:00:00.000Z", "monto": "90.00"},
        {**base, "pedido_id": f"{prefijo}-x4", "cliente_id": alguno, "fecha": "2026-06-12T15:00:00.000Z", "monto": "70.00"},
        {**base, "pedido_id": f"{prefijo}-x4", "cliente_id": alguno, "fecha": "2026-06-12T15:00:00.000Z", "monto": "700.00"},
        {**base, "pedido_id": f"{prefijo}-x5", "cliente_id": alguno, "fecha": "2026-06-13T15:00:00.000Z", "monto": ""},
    ]
    # Un importe extremo, válido: se conserva (el modelo lo atenúa con log1p, no se recorta)
    extremo = clientes[-1]["cliente_id"]
    extra.append({**base, "pedido_id": f"{prefijo}-x6", "cliente_id": extremo, "fecha": "2026-09-20T15:00:00.000Z", "monto": "25000.00"})
    return filas + extra


def generar_tienda(tienda_id: str, nombre: str, salida: Path, semilla: int = reglas.SEMILLA_POR_DEFECTO,
                   n_clientes: int = 260, escala_ticket: float = 1.0) -> dict:
    salida = Path(salida)
    salida.mkdir(parents=True, exist_ok=True)
    clientes, pedidos, devoluciones = _simular(tienda_id, n_clientes, escala_ticket, semilla)
    pd.DataFrame(clientes, columns=["tienda_id", "cliente_id", "registrado_en"]).to_csv(salida / "clientes.csv", index=False)
    pd.DataFrame(pedidos, columns=["tienda_id", "pedido_id", "cliente_id", "fecha", "estado", "monto", "moneda"]).to_csv(salida / "pedidos.csv", index=False)
    pd.DataFrame(devoluciones, columns=["tienda_id", "pedido_id", "fecha", "monto"]).to_csv(salida / "devoluciones.csv", index=False)
    (salida / "origen.json").write_text(json.dumps({
        "origen": "simulado", "tienda_id": tienda_id, "tienda_nombre": nombre, "corte": CORTE.isoformat(),
        "moneda": MONEDA, "semilla": semilla, "aviso": AVISO,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    (salida / MARCA).write_text(AVISO + "\n", encoding="utf-8")
    return {"tienda_id": tienda_id, "carpeta": str(salida), "clientes": len(clientes), "pedidos": len(pedidos), "devoluciones": len(devoluciones)}


def generar_demo(salida: Path, semilla: int = reglas.SEMILLA_POR_DEFECTO) -> list[dict]:
    """Dos tiendas ficticias, cada una en su propia carpeta (nunca se mezclan)."""
    return [
        generar_tienda(tienda, cfg["nombre"], Path(salida) / tienda, semilla, cfg["clientes"], cfg["escala_ticket"])
        for tienda, cfg in TIENDAS_DEMO.items()
    ]


def es_carpeta_simulada(carpeta: Path) -> bool:
    """Marca + origen 'simulado' en origen.json (datos) o en resultado.json (salidas)."""
    carpeta = Path(carpeta)
    if not (carpeta / MARCA).is_file():
        return False
    for nombre in ("origen.json", "resultado.json"):
        ruta = carpeta / nombre
        if ruta.is_file():
            try:
                return json.loads(ruta.read_text(encoding="utf-8")).get("origen") == "simulado"
            except (ValueError, OSError):
                return False
    return False


def eliminar_simulacion(carpeta: Path) -> bool:
    if not es_carpeta_simulada(carpeta):
        return False
    shutil.rmtree(carpeta)
    return True
