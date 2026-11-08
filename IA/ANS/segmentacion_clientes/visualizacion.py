"""Página HTML autocontenida (SVG en línea, sin dependencias) para ver los grupos de un entrenamiento.

Un panel por grupo: recencia (x) contra monto (y, escala logarítmica); los clientes del grupo en color
y el resto de la tienda en gris como contexto. Debajo, una tabla con los valores RFM de cada grupo.
No muestra identificadores de clientes.
"""
from __future__ import annotations

import html
import math
from pathlib import Path

import pandas as pd

ANCHO, ALTO, M_IZQ, M_ABA, M_SUP, M_DER = 300, 210, 52, 34, 12, 10


def _escala_log(vmin: float, vmax: float):
    a, b = math.log10(max(vmin, 1.0)), math.log10(max(vmax, 10.0))
    if b - a < 1e-9:
        b = a + 1
    return lambda v: M_SUP + (ALTO - M_SUP - M_ABA) * (1 - (math.log10(max(v, 1.0)) - a) / (b - a)), a, b


def _panel(todos: pd.DataFrame, grupo: dict, x_max: float, y, ya: float, yb: float, moneda: str) -> str:
    ancho_util = ANCHO - M_IZQ - M_DER
    x = lambda v: M_IZQ + ancho_util * (v / x_max if x_max else 0)
    partes = [f'<svg viewBox="0 0 {ANCHO} {ALTO}" role="img" aria-label="Grupo {grupo["grupo"]}: recencia contra monto">']
    for e in range(int(math.floor(ya)), int(math.ceil(yb)) + 1):
        yy = y(10**e)
        if M_SUP - 1 <= yy <= ALTO - M_ABA + 1:
            partes.append(f'<line class="grid" x1="{M_IZQ}" x2="{ANCHO - M_DER}" y1="{yy:.1f}" y2="{yy:.1f}"/>'
                          f'<text class="tick" x="{M_IZQ - 6}" y="{yy + 3:.1f}" text-anchor="end">{10**e:,.0f}</text>')
    for d in range(0, int(x_max) + 1, 90 if x_max > 200 else 30):
        partes.append(f'<text class="tick" x="{x(d):.1f}" y="{ALTO - M_ABA + 14}" text-anchor="middle">{d}</text>')
    partes.append(f'<line class="axis" x1="{M_IZQ}" x2="{ANCHO - M_DER}" y1="{ALTO - M_ABA}" y2="{ALTO - M_ABA}"/>')
    partes.append(f'<text class="axis-label" x="{M_IZQ + ancho_util / 2}" y="{ALTO - 4}" text-anchor="middle">días desde la última compra</text>')
    otros = todos[todos["grupo"] != grupo["grupo"]]
    propios = todos[todos["grupo"] == grupo["grupo"]]
    for f in otros.itertuples(index=False):
        partes.append(f'<circle class="ctx" cx="{x(f.recencia_dias):.1f}" cy="{y(f.monto):.1f}" r="2.5"/>')
    for f in propios.itertuples(index=False):
        partes.append(
            f'<circle class="pt" cx="{x(f.recencia_dias):.1f}" cy="{y(f.monto):.1f}" r="4">'
            f'<title>{f.recencia_dias} días · {f.frecuencia} pedidos · {moneda} {f.monto:,.2f}</title></circle>'
        )
    partes.append("</svg>")
    return "".join(partes)


def generar_html(resultado: dict, asignaciones: pd.DataFrame) -> str:
    moneda = resultado.get("moneda", "")
    e = html.escape
    simulado = resultado["origen"] == "simulado"
    cabecera = (
        f'<p class="banner demo">{e(resultado["aviso_origen"])}</p>' if simulado else f'<p class="banner">{e(resultado["aviso_origen"])}</p>'
    )
    d, dv = resultado["datos"]["clientes"], resultado.get("division", {})
    cuerpo = [cabecera]
    cuerpo.append(
        f'<p class="meta">Corte {e(resultado["corte"][:10])} · periodo {resultado["periodo"]["dias"]} días ({e(resultado["zona_horaria"])}) · '
        f'{d["elegibles"]} clientes elegibles de {d["total"]} · semilla {resultado["semilla"]}</p>'
    )
    if resultado["estado"] != "listo":
        cuerpo.append(f'<p class="warn">Datos insuficientes: {e(resultado.get("motivo", ""))}</p>')
        return _pagina(resultado, "".join(cuerpo))

    m = resultado["metricas"]
    fmt = lambda v: "no disponible" if v is None else f"{v:.4f}"
    cuerpo.append(
        f'<p class="meta">Entrenamiento {dv["entrenamiento"]} clientes · evaluación {dv["evaluacion"]} · k = {resultado["modelo"]["k"]} · '
        f'silhouette entrenamiento {fmt(m["entrenamiento"]["silhouette"])} / evaluación {fmt(m["evaluacion"]["silhouette"])}</p>'
    )
    for a in resultado.get("advertencias", []):
        cuerpo.append(f'<p class="warn">{e(a["texto"])}</p>')

    x_max = float(max(asignaciones["recencia_dias"].max(), 1))
    y, ya, yb = _escala_log(float(asignaciones["monto"].min()), float(asignaciones["monto"].max()))
    cuerpo.append('<div class="grid-panels">')
    for g in resultado["grupos"]:
        r = g["rfm"]
        cuerpo.append(
            f'<figure><figcaption><strong>Grupo {g["grupo"]}</strong> · {g["clientes"]} clientes ({g["porcentaje"]:.1f} %)'
            f'<span>{e(g["descripcion"])}</span></figcaption>'
            f'{_panel(asignaciones, g, x_max, y, ya, yb, moneda)}'
            f'<p class="small">Medianas: {r["recencia_dias"]["mediana"]:.0f} días · {r["frecuencia"]["mediana"]:.0f} pedidos · {moneda} {r["monto"]["mediana"]:,.2f}</p></figure>'
        )
    cuerpo.append("</div>")
    filas = "".join(
        f'<tr><td>Grupo {g["grupo"]}</td><td>{g["clientes"]}</td><td>{g["clientes_entrenamiento"]}</td><td>{g["clientes_evaluacion"]}</td>'
        f'<td>{g["rfm"]["recencia_dias"]["mediana"]:.0f} ({g["rfm"]["recencia_dias"]["p25"]:.0f}–{g["rfm"]["recencia_dias"]["p75"]:.0f})</td>'
        f'<td>{g["rfm"]["frecuencia"]["mediana"]:.0f} ({g["rfm"]["frecuencia"]["p25"]:.0f}–{g["rfm"]["frecuencia"]["p75"]:.0f})</td>'
        f'<td>{g["rfm"]["monto"]["mediana"]:,.2f} ({g["rfm"]["monto"]["p25"]:,.2f}–{g["rfm"]["monto"]["p75"]:,.2f})</td></tr>'
        for g in resultado["grupos"]
    )
    cuerpo.append(
        '<table><thead><tr><th>Grupo</th><th>Clientes</th><th>Entren.</th><th>Eval.</th><th>Recencia días, mediana (P25–P75)</th>'
        f'<th>Pedidos, mediana (P25–P75)</th><th>Monto {e(moneda)}, mediana (P25–P75)</th></tr></thead><tbody>{filas}</tbody></table>'
        '<p class="small">Los números de grupo los asigna este entrenamiento y pueden cambiar al reentrenar. La separación matemática es orientativa.</p>'
    )
    return _pagina(resultado, "".join(cuerpo))


def _pagina(resultado: dict, cuerpo: str) -> str:
    titulo = html.escape(f'Segmentación de clientes — {resultado["tienda_nombre"]}')
    return f"""<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Grupos de clientes</title><style>
:root{{--bg:#fcfcfb;--fg:#0b0b0b;--fg2:#52514e;--grid:#e6e5e0;--ctx:#c9c8c2;--pt:#2a78d6;--warn-bg:#fef3c7;--warn-fg:#92400e;--line:#d4d3cd}}
@media (prefers-color-scheme:dark){{:root:not([data-theme="light"]){{--bg:#1a1a19;--fg:#f0efec;--fg2:#c3c2b7;--grid:#2f2f2d;--ctx:#4a4a47;--pt:#3987e5;--warn-bg:#3b2f0b;--warn-fg:#fcd34d;--line:#3a3a37}}}}
:root[data-theme="dark"]{{--bg:#1a1a19;--fg:#f0efec;--fg2:#c3c2b7;--grid:#2f2f2d;--ctx:#4a4a47;--pt:#3987e5;--warn-bg:#3b2f0b;--warn-fg:#fcd34d;--line:#3a3a37}}
body{{background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif;margin:0 auto;max-width:1100px;padding:16px}}
h1{{font-size:1.3rem;margin:0 0 .5rem}} .meta,.small{{color:var(--fg2)}} .small{{font-size:12px}}
.banner{{padding:.5rem .75rem;border-radius:6px;border:1px solid var(--line)}} .banner.demo,.warn{{background:var(--warn-bg);color:var(--warn-fg);font-weight:600;padding:.5rem .75rem;border-radius:6px}}
.grid-panels{{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;margin:1rem 0}}
figure{{margin:0;border:1px solid var(--line);border-radius:8px;padding:10px}} figcaption span{{display:block;color:var(--fg2);font-size:12px}}
svg{{width:100%;height:auto;display:block}} .grid{{stroke:var(--grid);stroke-width:1}} .axis{{stroke:var(--fg2);stroke-width:1}}
.tick,.axis-label{{fill:var(--fg2);font-size:10px}} .ctx{{fill:var(--ctx)}} .pt{{fill:var(--pt);stroke:var(--bg);stroke-width:1}} .pt:hover{{stroke:var(--fg);stroke-width:2}}
table{{border-collapse:collapse;width:100%;font-size:13px;display:block;overflow-x:auto}} th,td{{border-bottom:1px solid var(--line);padding:6px 8px;text-align:right;white-space:nowrap}} th:first-child,td:first-child{{text-align:left}}
</style></head><body><h1>{titulo}</h1><p class="small">Eje vertical: monto del periodo (escala logarítmica). Pasa el cursor sobre un punto para ver sus valores.</p>{cuerpo}</body></html>"""


def escribir_html(resultado: dict, carpeta: Path) -> Path:
    ruta_csv = carpeta / "asignaciones.csv"
    asignaciones = pd.read_csv(ruta_csv) if ruta_csv.is_file() else pd.DataFrame(columns=["grupo", "recencia_dias", "frecuencia", "monto"])
    destino = carpeta / "grupos.html"
    destino.write_text(generar_html(resultado, asignaciones), encoding="utf-8")
    return destino
