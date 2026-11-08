"""Línea de comandos: python -m segmentacion_clientes <comando> ...

Códigos de salida: 0 = listo, 3 = datos insuficientes, 2 = entrada inválida, 1 = error inesperado.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import reglas
from .datos import ErrorEntrada
from .simulacion import eliminar_simulacion, generar_demo, generar_tienda

SALIDA_DATOS_INSUFICIENTES = 3
SALIDA_ENTRADA_INVALIDA = 2


def _cmd_simular(args) -> int:
    salida = Path(args.salida)
    if args.tienda_id:
        res = [generar_tienda(args.tienda_id, args.tienda_nombre or "Demo simulada", salida, args.semilla)]
    else:
        res = generar_demo(salida, args.semilla)
    for r in res:
        print(f"[SIMULADO] {r['tienda_id']}: {r['clientes']} clientes, {r['pedidos']} filas de pedidos, "
              f"{r['devoluciones']} devoluciones -> {Path(r['carpeta']).resolve()}")
    print("Aviso: son datos ficticios de demostración, no clientes ni compras reales.")
    return 0


def _cmd_entrenar(args) -> int:
    from .entrenamiento import entrenar_desde_carpeta  # import diferido: simular no necesita scikit-learn

    try:
        res = entrenar_desde_carpeta(Path(args.entrada), Path(args.salida), args.semilla, args.corte, args.periodo_dias)
    except ErrorEntrada as error:
        print(f"Entrada inválida: {error}", file=sys.stderr)
        return SALIDA_ENTRADA_INVALIDA
    _imprimir(res)
    return 0 if res["estado"] == "listo" else SALIDA_DATOS_INSUFICIENTES


def _leer_resultado(carpeta: Path) -> dict | None:
    ruta = carpeta / "resultado.json"
    if not ruta.is_file():
        print(f"No existe {ruta}: entrena primero.", file=sys.stderr)
        return None
    return json.loads(ruta.read_text(encoding="utf-8"))


def _cmd_mostrar(args) -> int:
    res = _leer_resultado(Path(args.salida))
    if res is None:
        return SALIDA_ENTRADA_INVALIDA
    if args.json:
        print(json.dumps(res, ensure_ascii=False, indent=2))
    else:
        _imprimir(res)
    return 0


def _cmd_visualizar(args) -> int:
    from .visualizacion import escribir_html

    carpeta = Path(args.salida)
    res = _leer_resultado(carpeta)
    if res is None:
        return SALIDA_ENTRADA_INVALIDA
    print(f"Visualización: {escribir_html(res, carpeta).resolve()}")
    return 0


def _cmd_limpiar(args) -> int:
    """Borra solo carpetas marcadas como simuladas (DATOS_SIMULADOS.txt + origen 'simulado')."""
    borradas = 0
    for base in [Path(p) for p in args.carpetas]:
        if not base.is_dir():
            continue
        for carpeta in [base] + sorted(c for c in base.iterdir() if c.is_dir()):
            if carpeta.exists() and eliminar_simulacion(carpeta):
                print(f"Eliminada (simulada): {carpeta}")
                borradas += 1
    print(f"{borradas} carpeta(s) simulada(s) eliminada(s). Nada real fue tocado.")
    return 0


def _num(v) -> str:
    return "no disponible" if v is None else f"{v:.4f}"


def _imprimir(res: dict) -> None:
    etiqueta = "[SIMULADO]" if res["origen"] == "simulado" else "[REAL]"
    print(f"{etiqueta} {res['tienda_nombre']} ({res['tienda_id']})")
    print(f"  {res['aviso_origen']}")
    print(f"  Estado: {res['estado']}   Versión: {res['version_modelo']}   Semilla: {res['semilla']}")
    print(f"  Corte: {res['corte']}   Periodo: {res['periodo']['desde'][:10]} a {res['periodo']['hasta_exclusivo'][:10]} "
          f"(excluido) = {res['periodo']['dias']} días, {res['zona_horaria']}   Moneda: {res['moneda']}")
    d = res["datos"]
    c, p = d["clientes"], d["pedidos"]
    print(f"  Clientes: {c['total']} en total, {c['elegibles']} elegibles, {c['sin_compras_validas']} sin compras válidas, "
          f"{c['sin_compras_en_periodo']} sin compras en el periodo")
    excl = {k: v for k, v in p["excluidos"].items() if v}
    print(f"  Pedidos: {p['filas_leidas']} filas, {p['duplicados_exactos_descartados']} duplicados exactos, excluidos {excl or 'ninguno'}, "
          f"{p['pendientes']} pendientes, {p['cancelados']} cancelados, {p['validos_en_periodo']} válidos en el periodo")
    dev = d["devoluciones"]
    print(f"  Devoluciones (informativo, no se restan): {dev['pedidos_con_devolucion']} pedidos, {res['moneda']} {dev['monto_devuelto']}")
    if res["estado"] != "listo":
        if "division" in res:
            dv = res["division"]
            print(f"  División: {dv['entrenamiento']} entrenamiento / {dv['evaluacion']} evaluación")
        print(f"  Datos insuficientes: {res.get('motivo')}")
        return
    dv, m = res["division"], res["metricas"]
    print(f"  División por cliente: {dv['total']} = {dv['entrenamiento']} entrenamiento ({dv['porcentaje_entrenamiento']} %) + "
          f"{dv['evaluacion']} evaluación   semilla {dv['semilla']}")
    print("  Selección de k (solo entrenamiento): " + ", ".join(
        f"k={r['k']}: {_num(r['silhouette'])}" for r in res["seleccion_k"]["resultados"]) + f"  -> k = {res['modelo']['k']}")
    for nombre in ("entrenamiento", "evaluacion"):
        x = m[nombre]
        extra = f"  ({x['motivo_no_disponible']})" if x["motivo_no_disponible"] else ""
        print(f"  {nombre.capitalize():14s} clientes {x['clientes']:4d}  silhouette {_num(x['silhouette'])}  "
              f"Davies-Bouldin {_num(x['davies_bouldin'])}  inercia media {x['inercia_media']:.4f}{extra}")
    for a in res.get("advertencias", []):
        print(f"  Advertencia: {a['texto']}")
    print(f"  Modelo: {res['modelo']['archivo']} (sha256 {res['modelo']['sha256'][:16]}…)")
    print("  Grupos (todos los elegibles, asignados con el modelo fijo):")
    for g in res["grupos"]:
        r = g["rfm"]
        print(f"    Grupo {g['grupo']}: {g['clientes']:4d} clientes ({g['porcentaje']:5.1f} %; {g['clientes_entrenamiento']} entren. / "
              f"{g['clientes_evaluacion']} eval.)  medianas: {r['recencia_dias']['mediana']:.0f} días, "
              f"{r['frecuencia']['mediana']:.0f} pedidos, {res['moneda']} {r['monto']['mediana']:,.2f}")
        print(f"             {g['descripcion']}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m segmentacion_clientes", description="Segmentación de clientes RFM + K-Means (no supervisado)")
    sub = parser.add_subparsers(dest="comando", required=True)

    p = sub.add_parser("simular", help="Genera clientes y compras SIMULADOS de demostración")
    p.add_argument("--salida", default="datos_demo")
    p.add_argument("--semilla", type=int, default=reglas.SEMILLA_POR_DEFECTO)
    p.add_argument("--tienda-id", help="Genera una sola tienda ficticia con este identificador (lo usa la API)")
    p.add_argument("--tienda-nombre")
    p.set_defaults(func=_cmd_simular)

    p = sub.add_parser("entrenar", help="Construye RFM, divide 80/20 por cliente, entrena y evalúa (una tienda)")
    p.add_argument("--entrada", required=True, help="Carpeta de UNA tienda (origen.json + CSV)")
    p.add_argument("--salida", required=True)
    p.add_argument("--semilla", type=int, default=reglas.SEMILLA_POR_DEFECTO)
    p.add_argument("--corte", help="Fecha de corte ISO (por defecto, la de la extracción). Ej.: 2026-10-01T00:00:00Z")
    p.add_argument("--periodo-dias", type=int, default=reglas.PERIODO_DIAS_POR_DEFECTO)
    p.set_defaults(func=_cmd_entrenar)

    p = sub.add_parser("mostrar", help="Muestra división, métricas y grupos de un entrenamiento")
    p.add_argument("--salida", required=True)
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=_cmd_mostrar)

    p = sub.add_parser("visualizar", help="Genera grupos.html (gráficos por grupo) en la carpeta de salida")
    p.add_argument("--salida", required=True)
    p.set_defaults(func=_cmd_visualizar)

    p = sub.add_parser("limpiar-demo", help="Elimina solo carpetas marcadas como simuladas")
    p.add_argument("carpetas", nargs="+")
    p.set_defaults(func=_cmd_limpiar)

    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except Exception as error:  # noqa: BLE001 - la API solo necesita el código y un mensaje corto
        print(f"Error inesperado: {type(error).__name__}: {error}", file=sys.stderr)
        return 1
