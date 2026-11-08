"""Lectura y validación de una carpeta de entrada (una sola tienda).

El formato es el mismo para los dos orígenes:
  - "simulado": lo escribe `simulacion.py` (demo, sin datos personales).
  - "real": lo exporta la API de la tienda autenticada (api/src/modules/sales-forecast), en solo
    lectura y dentro del schema de esa tienda.

Archivos:
  origen.json       {"origen", "tienda_id", "tienda_nombre", "corte", "semilla", "aviso"}
  ventas.csv        tienda_id, pedido_id, fecha, estado, sucursal_id, producto_id, talla, unidades
  devoluciones.csv  tienda_id, fecha, sucursal_id, producto_id, talla, unidades
  productos.csv     tienda_id, producto_id, nombre, categoria, creado_en, activo
  sucursales.csv    tienda_id, sucursal_id, nombre, creada_en, activa

Ningún archivo contiene clientes, correos, direcciones, pagos ni tokens.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from . import reglas

ORIGENES = ("simulado", "real")

COLUMNAS = {
    "ventas.csv": ["tienda_id", "pedido_id", "fecha", "estado", "sucursal_id", "producto_id", "talla", "unidades"],
    "devoluciones.csv": ["tienda_id", "fecha", "sucursal_id", "producto_id", "talla", "unidades"],
    "productos.csv": ["tienda_id", "producto_id", "nombre", "categoria", "creado_en", "activo"],
    "sucursales.csv": ["tienda_id", "sucursal_id", "nombre", "creada_en", "activa"],
}


class ErrorEntrada(ValueError):
    """La carpeta de entrada no cumple el formato o mezcla tiendas/orígenes."""


@dataclass
class DatosTienda:
    origen: str
    tienda_id: str
    tienda_nombre: str
    corte: pd.Timestamp  # momento de la extracción (UTC)
    semilla: int | None
    ventas: pd.DataFrame
    devoluciones: pd.DataFrame
    productos: pd.DataFrame
    sucursales: pd.DataFrame


def _leer_csv(carpeta: Path, nombre: str) -> pd.DataFrame:
    ruta = carpeta / nombre
    if not ruta.is_file():
        raise ErrorEntrada(f"Falta el archivo {nombre} en {carpeta}")
    df = pd.read_csv(ruta, dtype=str, keep_default_na=False)
    faltan = [c for c in COLUMNAS[nombre] if c not in df.columns]
    if faltan:
        raise ErrorEntrada(f"{nombre}: faltan columnas {faltan}")
    return df[COLUMNAS[nombre]].copy()


def _a_utc(serie: pd.Series, archivo: str) -> pd.Series:
    fechas = pd.to_datetime(serie, utc=True, errors="coerce", format="ISO8601")
    if fechas.isna().any():
        raise ErrorEntrada(f"{archivo}: {int(fechas.isna().sum())} fechas inválidas")
    return fechas


def _a_bool(serie: pd.Series) -> pd.Series:
    return serie.str.strip().str.lower().isin({"true", "1", "t", "si", "sí"})


def cargar_carpeta(carpeta: str | Path) -> DatosTienda:
    carpeta = Path(carpeta)
    ruta_origen = carpeta / "origen.json"
    if not ruta_origen.is_file():
        raise ErrorEntrada(f"Falta origen.json en {carpeta}")
    meta = json.loads(ruta_origen.read_text(encoding="utf-8"))
    origen = meta.get("origen")
    if origen not in ORIGENES:
        raise ErrorEntrada(f"origen.json: 'origen' debe ser uno de {ORIGENES}")
    tienda_id = str(meta.get("tienda_id") or "").strip()
    if not tienda_id:
        raise ErrorEntrada("origen.json: falta 'tienda_id'")
    corte = pd.Timestamp(meta["corte"])
    corte = corte.tz_localize("UTC") if corte.tzinfo is None else corte.tz_convert("UTC")

    tablas = {nombre: _leer_csv(carpeta, nombre) for nombre in COLUMNAS}

    # Una carpeta = una tienda. Cualquier fila de otra tienda aborta: nunca se mezclan.
    for nombre, df in tablas.items():
        otras = set(df["tienda_id"].unique()) - {tienda_id}
        if otras:
            raise ErrorEntrada(f"{nombre} contiene filas de otra tienda: no se mezclan tiendas")

    ventas = tablas["ventas.csv"]
    ventas["fecha"] = _a_utc(ventas["fecha"], "ventas.csv")
    ventas["unidades"] = pd.to_numeric(ventas["unidades"], errors="raise").astype("int64")
    ventas["estado"] = ventas["estado"].str.strip().str.upper()
    desconocidos = set(ventas["estado"].unique()) - reglas.ESTADOS_VALIDOS - reglas.ESTADOS_EXCLUIDOS
    if desconocidos:
        raise ErrorEntrada(f"ventas.csv: estados desconocidos {sorted(desconocidos)}")
    if (ventas["unidades"] <= 0).any():
        raise ErrorEntrada("ventas.csv: hay líneas con unidades <= 0")

    devoluciones = tablas["devoluciones.csv"]
    devoluciones["fecha"] = _a_utc(devoluciones["fecha"], "devoluciones.csv")
    devoluciones["unidades"] = pd.to_numeric(devoluciones["unidades"], errors="raise").astype("int64")

    for df in (ventas, devoluciones):
        df["talla"] = df["talla"].str.strip().replace("", reglas.TALLA_UNICA)
        df["sucursal_id"] = df["sucursal_id"].str.strip().replace("", reglas.SIN_SUCURSAL)

    productos = tablas["productos.csv"]
    productos["creado_en"] = _a_utc(productos["creado_en"], "productos.csv")
    productos["activo"] = _a_bool(productos["activo"])
    productos["categoria"] = productos["categoria"].str.strip().replace("", "SIN_CATEGORIA")

    sucursales = tablas["sucursales.csv"]
    sucursales["creada_en"] = _a_utc(sucursales["creada_en"], "sucursales.csv")
    sucursales["activa"] = _a_bool(sucursales["activa"])

    return DatosTienda(
        origen=origen,
        tienda_id=tienda_id,
        tienda_nombre=str(meta.get("tienda_nombre") or tienda_id),
        corte=corte,
        semilla=meta.get("semilla"),
        ventas=ventas,
        devoluciones=devoluciones,
        productos=productos,
        sucursales=sucursales,
    )
