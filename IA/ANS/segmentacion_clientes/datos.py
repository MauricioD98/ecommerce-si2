"""Lectura y validación de una carpeta de entrada (una sola tienda).

El formato es el mismo para los dos orígenes:
  - "simulado": lo escribe `simulacion.py` (demo, clientes ficticios).
  - "real": lo exporta la API para la tienda autenticada (api/src/modules/customer-segmentation),
    en solo lectura y dentro del schema de esa tienda.

Archivos:
  origen.json       {"origen", "tienda_id", "tienda_nombre", "corte", "moneda", "semilla", "aviso", ...}
  clientes.csv      tienda_id, cliente_id, registrado_en
  pedidos.csv       tienda_id, pedido_id, cliente_id, fecha, estado, monto, moneda
  devoluciones.csv  tienda_id, pedido_id, fecha, monto

`cliente_id` y `pedido_id` son identificadores técnicos seudónimos: ningún archivo contiene nombres,
correos, teléfonos, direcciones, contraseñas, tokens, tarjetas ni datos bancarios. Los identificadores
no se usan como variables del modelo.

Errores estructurales (archivos o columnas faltantes, filas de otra tienda, monedas mezcladas) abortan
con ErrorEntrada. Los problemas fila a fila (fechas inválidas, importes negativos, duplicados…) no
abortan: se excluyen y se cuentan en `rfm.py`, sin modificar los archivos originales.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

ORIGENES = ("simulado", "real")

COLUMNAS = {
    "clientes.csv": ["tienda_id", "cliente_id", "registrado_en"],
    "pedidos.csv": ["tienda_id", "pedido_id", "cliente_id", "fecha", "estado", "monto", "moneda"],
    "devoluciones.csv": ["tienda_id", "pedido_id", "fecha", "monto"],
}


class ErrorEntrada(ValueError):
    """La carpeta de entrada no cumple el formato o mezcla tiendas, orígenes o monedas."""


@dataclass
class DatosTienda:
    origen: str
    tienda_id: str
    tienda_nombre: str
    corte_extraccion: pd.Timestamp  # momento de la extracción (UTC)
    moneda: str
    semilla: int | None
    meta: dict
    clientes: pd.DataFrame  # columnas como texto, tal cual se leyeron
    pedidos: pd.DataFrame
    devoluciones: pd.DataFrame


def a_utc(valor) -> pd.Timestamp:
    ts = pd.Timestamp(valor)
    return ts.tz_localize("UTC") if ts.tzinfo is None else ts.tz_convert("UTC")


def _leer_csv(carpeta: Path, nombre: str) -> pd.DataFrame:
    ruta = carpeta / nombre
    if not ruta.is_file():
        raise ErrorEntrada(f"Falta el archivo {nombre} en {carpeta}")
    df = pd.read_csv(ruta, dtype=str, keep_default_na=False)
    faltan = [c for c in COLUMNAS[nombre] if c not in df.columns]
    if faltan:
        raise ErrorEntrada(f"{nombre}: faltan columnas {faltan}")
    df = df[COLUMNAS[nombre]].copy()
    for columna in df.columns:
        df[columna] = df[columna].str.strip()
    return df


def validar(datos: DatosTienda) -> DatosTienda:
    """Reglas estructurales comunes a la carga desde disco y a los datos armados en memoria."""
    if datos.origen not in ORIGENES:
        raise ErrorEntrada(f"'origen' debe ser uno de {ORIGENES}")
    if not datos.tienda_id:
        raise ErrorEntrada("Falta 'tienda_id'")
    if not datos.moneda:
        raise ErrorEntrada("Falta 'moneda': no se puede sumar montos sin una moneda documentada")
    # Una carpeta = una tienda. Cualquier fila de otra tienda aborta: nunca se mezclan tiendas.
    for nombre, df in (("clientes.csv", datos.clientes), ("pedidos.csv", datos.pedidos), ("devoluciones.csv", datos.devoluciones)):
        otras = set(df["tienda_id"].astype(str).unique()) - {datos.tienda_id}
        if otras:
            raise ErrorEntrada(f"{nombre} contiene filas de otra tienda: no se mezclan tiendas")
    # No se suman importes en monedas distintas: si aparecen varias, se informa y no se entrena.
    monedas = {m.upper() for m in datos.pedidos["moneda"].astype(str) if m}
    if monedas - {datos.moneda.upper()}:
        raise ErrorEntrada(
            f"pedidos.csv tiene montos en {sorted(monedas | {datos.moneda.upper()})}: no se combinan monedas distintas"
        )
    return datos


def cargar_carpeta(carpeta: str | Path) -> DatosTienda:
    carpeta = Path(carpeta)
    ruta_origen = carpeta / "origen.json"
    if not ruta_origen.is_file():
        raise ErrorEntrada(f"Falta origen.json en {carpeta}")
    try:
        meta = json.loads(ruta_origen.read_text(encoding="utf-8"))
        corte = a_utc(meta["corte"])
    except (ValueError, KeyError, TypeError) as error:
        raise ErrorEntrada(f"origen.json inválido: {error}") from error

    tablas = {nombre: _leer_csv(carpeta, nombre) for nombre in COLUMNAS}
    return validar(DatosTienda(
        origen=str(meta.get("origen") or ""),
        tienda_id=str(meta.get("tienda_id") or "").strip(),
        tienda_nombre=str(meta.get("tienda_nombre") or meta.get("tienda_id") or ""),
        corte_extraccion=corte,
        moneda=str(meta.get("moneda") or "").strip().upper(),
        semilla=meta.get("semilla"),
        meta=meta,
        clientes=tablas["clientes.csv"],
        pedidos=tablas["pedidos.csv"],
        devoluciones=tablas["devoluciones.csv"],
    ))
