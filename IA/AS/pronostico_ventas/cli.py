"""Línea de comandos: python -m pronostico_ventas <comando> ...

Códigos de salida: 0 = listo, 3 = datos insuficientes, 2 = entrada inválida, 1 = error inesperado.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

from . import reglas
from .datos import ErrorEntrada
from .simulacion import MARCA, eliminar_simulacion, es_carpeta_simulada, generar_demo, generar_tienda

SALIDA_DATOS_INSUFICIENTES = 3
SALIDA_ENTRADA_INVALIDA = 2


def _cmd_simular(args) -> int:
    salida = Path(args.salida)
    if args.tienda_id:
        res = [generar_tienda(args.tienda_id, args.tienda_nombre or f"Demo {args.tienda_id[:8]} (simulada)", salida, args.semilla)]
    else:
        res = generar_demo(salida, args.semilla)
    for r in res:
        print(f"[SIMULADO] {r['tienda_id']}: {r['lineas']} líneas de pedido, {r['devoluciones']} devoluciones -> {r['carpeta']}")
    print("Aviso: son datos ficticios de demostración, no ventas reales.")
    return 0


def _cmd_entrenar(args) -> int:
    from .entrenamiento import entrenar_desde_carpeta  # import diferido: simular no necesita scikit-learn

    try:
        res = entrenar_desde_carpeta(Path(args.entrada), Path(args.salida), args.semilla)
    except ErrorEntrada as error:
        print(f"Entrada inválida: {error}", file=sys.stderr)
        return SALIDA_ENTRADA_INVALIDA
    _imprimir(res, limite=10)
    return 0 if res["estado"] == "listo" else SALIDA_DATOS_INSUFICIENTES


def _cmd_mostrar(args) -> int:
    ruta = Path(args.salida) / "resultado.json"
    if not ruta.is_file():
        print(f"No existe {ruta}: entrena primero.", file=sys.stderr)
        return SALIDA_ENTRADA_INVALIDA
    res = json.loads(ruta.read_text(encoding="utf-8"))
    if args.json:
        print(json.dumps(res, ensure_ascii=False, indent=2))
    else:
        _imprimir(res, limite=args.limite)
    return 0


def _cmd_limpiar(args) -> int:
    """Borra solo carpetas marcadas como simuladas (DATOS_SIMULADOS.txt + origen simulado)."""
    borradas = 0
    for base in [Path(p) for p in args.carpetas]:
        if not base.is_dir():
            continue
        candidatas = [base] + [c for c in base.iterdir() if c.is_dir()]
        for carpeta in candidatas:
            if eliminar_simulacion(carpeta) or _eliminar_salida_simulada(carpeta):
                print(f"Eliminada (simulada): {carpeta}")
                borradas += 1
    print(f"{borradas} carpeta(s) simulada(s) eliminada(s). Nada real fue tocado.")
    return 0


def _eliminar_salida_simulada(carpeta: Path) -> bool:
    resultado = carpeta / "resultado.json"
    if not (carpeta / MARCA).is_file() or not resultado.is_file():
        return False
    try:
        if json.loads(resultado.read_text(encoding="utf-8")).get("origen") != "simulado":
            return False
    except (ValueError, OSError):
        return False
    shutil.rmtree(carpeta)
    return True


def _imprimir(res: dict, limite: int) -> None:
    etiqueta = "[SIMULADO]" if res["origen"] == "simulado" else "[REAL]"
    print(f"{etiqueta} {res['tienda_nombre']} ({res['tienda_id']})")
    print(f"  {res['aviso_origen']}")
    print(f"  Estado: {res['estado']}   Versión del modelo: {res['version_modelo']}   Semilla: {res['semilla']}")
    print(f"  Corte de datos: {res['corte_datos']}   Periodo pronosticado: {res['periodo_pronosticado']['desde']} a {res['periodo_pronosticado']['hasta']}")
    d = res["datos"]
    print(f"  Datos: {d['lineas_pedido']} líneas, ventas del {d['primera_venta']} al {d['ultima_venta']}, {d['series']} series, "
          f"{d['semanas_objetivo_elegibles']} semanas objetivo elegibles, {d['filas_elegibles']} filas")
    if res["estado"] != "listo":
        print(f"  Motivo: {res.get('motivo')}")
    else:
        dv, m = res["division"], res["metricas_prueba"]
        for nombre in ("entrenamiento", "prueba"):
            c = dv[nombre]
            print(f"  {nombre.capitalize():14s} {c['semanas']:4d} semanas  {c['filas']:6d} filas  {c['desde']} a {c['hasta']}")
        print(f"  % semanas en entrenamiento: {dv['porcentaje_semanas_entrenamiento']}  % filas: {dv['porcentaje_filas_entrenamiento']}")
        print(f"  Hiperparámetros: {res['modelo']['hiperparametros']}")
        print(f"  MAE modelo: {m['mae_modelo']}   MAE línea base (prom. 4 semanas): {m['mae_linea_base_promedio_4_semanas']}   "
              f"MAE semana anterior: {m['mae_linea_base_semana_anterior']}   (filas de prueba: {m['filas']})")
        print(f"  ¿Supera la línea base principal?: {'sí' if m['supera_linea_base_principal'] else 'no'}")
        print(f"  Modelo: {res['modelo']['archivo']} (sha256 {res['modelo']['sha256'][:16]}…)")
    filas = res["pronostico"]
    print(f"  Pronóstico ({len(filas)} filas, mostrando {min(limite, len(filas))}):")
    for f in filas[:limite]:
        unidades = "—" if f["unidades_previstas"] is None else f"{f['unidades_mostradas']} ({f['unidades_previstas']})"
        print(f"    {str(f['sucursal_nombre'] or '—'):24s} {f['producto_nombre'][:28]:28s} {str(f['talla'] or '—'):6s} {unidades:>14s}  {f['metodo']}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m pronostico_ventas", description="Pronóstico semanal de ventas (aprendizaje supervisado)")
    sub = parser.add_subparsers(dest="comando", required=True)

    p = sub.add_parser("simular", help="Genera datos SIMULADOS de demostración")
    p.add_argument("--salida", default="datos_demo")
    p.add_argument("--semilla", type=int, default=reglas.SEMILLA_POR_DEFECTO)
    p.add_argument("--tienda-id", help="Genera una sola tienda ficticia con este identificador (lo usa la API)")
    p.add_argument("--tienda-nombre")
    p.set_defaults(func=_cmd_simular)

    p = sub.add_parser("entrenar", help="Prepara el dataset, divide 80/20, entrena, evalúa y pronostica (una tienda)")
    p.add_argument("--entrada", required=True, help="Carpeta de UNA tienda (origen.json + CSV)")
    p.add_argument("--salida", required=True)
    p.add_argument("--semilla", type=int, default=reglas.SEMILLA_POR_DEFECTO)
    p.set_defaults(func=_cmd_entrenar)

    p = sub.add_parser("mostrar", help="Muestra métricas y pronóstico de un entrenamiento")
    p.add_argument("--salida", required=True)
    p.add_argument("--limite", type=int, default=20)
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=_cmd_mostrar)

    p = sub.add_parser("limpiar-demo", help="Elimina solo carpetas marcadas como simuladas")
    p.add_argument("carpetas", nargs="+")
    p.set_defaults(func=_cmd_limpiar)

    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except Exception as error:  # noqa: BLE001 - la API solo necesita el código y un mensaje corto
        print(f"Error inesperado: {type(error).__name__}: {error}", file=sys.stderr)
        return 1
