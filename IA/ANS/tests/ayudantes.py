"""Construye tiendas pequeñas en memoria para las pruebas."""
from __future__ import annotations

import pandas as pd

from segmentacion_clientes.datos import DatosTienda, validar

CORTE = pd.Timestamp("2026-07-01T00:00:00Z")


def hace(dias: float, corte: pd.Timestamp = CORTE) -> str:
    return (corte - pd.Timedelta(days=dias)).isoformat()


def tienda(pedidos, clientes=None, devoluciones=(), tienda_id="t1", origen="simulado", moneda="BOB",
           corte: pd.Timestamp = CORTE) -> DatosTienda:
    """pedidos: tuplas (pedido_id, cliente_id, fecha_iso, estado, monto[, moneda])."""
    filas = []
    for p in pedidos:
        pid, cli, fecha, estado, monto, *resto = p
        filas.append({"tienda_id": tienda_id, "pedido_id": pid, "cliente_id": cli, "fecha": fecha,
                      "estado": estado, "monto": str(monto), "moneda": resto[0] if resto else moneda})
    ped = pd.DataFrame(filas, columns=["tienda_id", "pedido_id", "cliente_id", "fecha", "estado", "monto", "moneda"])
    ids = clientes if clientes is not None else sorted({p[1] for p in pedidos if p[1]})
    cli = pd.DataFrame([{"tienda_id": tienda_id, "cliente_id": c, "registrado_en": hace(800, corte)} for c in ids],
                       columns=["tienda_id", "cliente_id", "registrado_en"])
    dev = pd.DataFrame([{"tienda_id": tienda_id, "pedido_id": d[0], "fecha": d[1], "monto": str(d[2])} for d in devoluciones],
                       columns=["tienda_id", "pedido_id", "fecha", "monto"])
    return validar(DatosTienda(origen, tienda_id, "Tienda prueba", corte, moneda, 1, {}, cli, ped, dev))


def tienda_variada(n: int, tienda_id="t1", identicos: bool = False) -> DatosTienda:
    """n clientes con tres comportamientos distintos (o todos idénticos)."""
    pedidos, k = [], 0
    for i in range(n):
        cli = f"c{i:04d}"
        if identicos:
            plan = [(10, 100.0)]
        elif i % 3 == 0:
            plan = [(5 + i % 7 + 30 * j, 900.0 + 13 * (i % 11)) for j in range(8)]
        elif i % 3 == 1:
            plan = [(60 + i % 13 + 90 * j, 300.0 + 7 * (i % 5)) for j in range(2)]
        else:
            plan = [(250 + i % 40, 80.0 + i % 9)]
        for dias, monto in plan:
            k += 1
            pedidos.append((f"p{k}", cli, hace(dias + 0.5), "ENTREGADO", monto))
    return tienda(pedidos, tienda_id=tienda_id)
