"""Construye tiendas pequeñas en memoria para las pruebas."""
from __future__ import annotations

import pandas as pd

from pronostico_ventas.datos import DatosTienda

LUNES0 = pd.Timestamp("2026-01-05", tz="UTC")  # lunes


def lunes(k: int) -> pd.Timestamp:
    return LUNES0 + pd.Timedelta(weeks=k)


def tienda(lineas, devoluciones=(), productos=None, sucursales=None, corte_semana: int = 20,
           tienda_id: str = "t1", origen: str = "simulado") -> DatosTienda:
    """lineas: tuplas (fecha, estado, sucursal, producto, talla, unidades)."""
    ventas = pd.DataFrame(
        [{"tienda_id": tienda_id, "pedido_id": f"p{i}", "fecha": f, "estado": e, "sucursal_id": s,
          "producto_id": p, "talla": t, "unidades": u} for i, (f, e, s, p, t, u) in enumerate(lineas)],
        columns=["tienda_id", "pedido_id", "fecha", "estado", "sucursal_id", "producto_id", "talla", "unidades"],
    )
    ventas["fecha"] = pd.to_datetime(ventas["fecha"], utc=True)
    dev = pd.DataFrame(
        [{"tienda_id": tienda_id, "fecha": f, "sucursal_id": s, "producto_id": p, "talla": t, "unidades": u}
         for (f, s, p, t, u) in devoluciones],
        columns=["tienda_id", "fecha", "sucursal_id", "producto_id", "talla", "unidades"],
    )
    dev["fecha"] = pd.to_datetime(dev["fecha"], utc=True)
    productos = productos if productos is not None else pd.DataFrame([
        {"tienda_id": tienda_id, "producto_id": "A", "nombre": "Prod A", "categoria": "Blusas", "creado_en": LUNES0, "activo": True},
        {"tienda_id": tienda_id, "producto_id": "B", "nombre": "Prod B", "categoria": "Jeans", "creado_en": LUNES0, "activo": True},
    ])
    sucursales = sucursales if sucursales is not None else pd.DataFrame([
        {"tienda_id": tienda_id, "sucursal_id": "S1", "nombre": "Suc 1", "creada_en": LUNES0, "activa": True},
    ])
    return DatosTienda(origen, tienda_id, "Tienda prueba", lunes(corte_semana), 1, ventas, dev, productos, sucursales)


def serie_semanal(valores, producto="A", sucursal="S1", talla="M", desde: int = 0, estado="ENTREGADO"):
    """Una línea por semana (miércoles) con las unidades dadas; 0 = semana sin líneas."""
    return [(lunes(desde + k) + pd.Timedelta(days=2, hours=10), estado, sucursal, producto, talla, int(v))
            for k, v in enumerate(valores) if v > 0]
