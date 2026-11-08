# IA/ANS — Segmentación de clientes con aprendizaje no supervisado

Agrupa a los clientes **de una tienda** según su comportamiento de compra, con las variables **RFM** y
**K-Means**. Cada tienda tiene su propio modelo; nunca se mezclan clientes de tiendas distintas.

| Variable | Cálculo |
|---|---|
| Recencia | Días completos entre la última compra válida del periodo y la fecha de corte |
| Frecuencia | Pedidos válidos distintos del periodo |
| Monto | Suma del importe **bruto** de esos pedidos (`orders.totalAmount`, una sola moneda) |

- `IA/ANS` = aprendizaje no supervisado (este módulo). `IA/AS` = pronóstico de ventas supervisado (no se modificó).
- Modelo: `Pipeline` de scikit-learn = `FunctionTransformer(log1p)` + `StandardScaler` + `KMeans(n_init=10, random_state=semilla)`.
- **División 80/20 por cliente** (no por pedido ni por semana): `floor(n*8/10)` clientes entrenan y el resto evalúa.
- Métricas: **silhouette**, **Davies-Bouldin** e inercia media, por separado para entrenamiento y evaluación.
  No existe una "precisión": no hay etiquetas correctas. El 80/20 describe cómo se reparten los datos.
- Los grupos se descubren sin etiquetas previas. Las descripciones ("compran con más frecuencia"…) se calculan
  **después** del entrenamiento, comparando la mediana del grupo con la de la tienda. El número de grupo puede
  cambiar al reentrenar.
- No predice abandono ni ejecuta acciones, mensajes, descuentos o campañas.

> **Datos simulados ≠ datos reales.** El generador crea clientes y compras ficticios y reproducibles para
> demostrar el recorrido. Una buena separación con ellos **no** dice nada de los clientes reales.

---

## 1. Instalación (Windows PowerShell)

Desde la raíz del repositorio (`ecommerce-si2`):

```powershell
Set-Location .\IA\ANS
python --version                      # probado con Python 3.13.16
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Versiones fijadas en `requirements.txt` (probadas en Windows 11, sin GPU): pandas 3.1.1, NumPy 2.5.4,
scikit-learn 1.9.1, SciPy 1.18.1, joblib 1.6.0.

Todos los comandos usan la ruta directa `.\.venv\Scripts\python.exe`, que funciona aunque PowerShell bloquee
la activación de scripts. Si aun así quieres activar el entorno y aparece "la ejecución de scripts está
deshabilitada", habilítalo **solo para esta ventana**:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

Pruebas del módulo (20 pruebas, ~5 s):

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -t .
```

## 2. Generar datos simulados (demo aislada)

```powershell
.\.venv\Scripts\python.exe -m segmentacion_clientes simular --salida datos_demo
```

Crea dos tiendas **ficticias**, cada una en su carpeta y con la ruta completa impresa en la consola:
`datos_demo\demo_tienda_a` (260 clientes) y `datos_demo\demo_tienda_b` (160 clientes). Cada carpeta tiene
`DATOS_SIMULADOS.txt` y `origen.json` con `"origen": "simulado"`. No toca ninguna base de datos ni Stripe.

- Semilla por defecto `20261107` (`--semilla N` para cambiarla). Misma semilla ⇒ mismos archivos.
- Fechas fijas: compras desde 2024-11-01; corte simulado 2026-11-01 00:00 UTC; moneda BOB.
- Incluye clientes sin compras válidas, clientes que solo compraron antes del periodo, pedidos pendientes y
  cancelados, devoluciones y registros problemáticos a propósito: duplicados exactos, un id de pedido repetido
  con datos distintos, fecha inválida, importe vacío, importe negativo, pedido sin cliente y un importe extremo.
- Identificadores seudónimos (`demo_tie-c0001`…): sin nombres, correos, teléfonos ni datos de pago.

## 3. Preparar RFM, dividir 80/20 y entrenar (una tienda por vez)

```powershell
.\.venv\Scripts\python.exe -m segmentacion_clientes entrenar --entrada datos_demo\demo_tienda_a --salida salidas\demo_tienda_a
.\.venv\Scripts\python.exe -m segmentacion_clientes entrenar --entrada datos_demo\demo_tienda_b --salida salidas\demo_tienda_b
```

Cada comando:

1. Construye una fila RFM por cliente con la fecha de corte (por defecto, la de la extracción) y el periodo
   `[corte − 365 días, corte)` en UTC. Opcional: `--corte 2026-10-01T00:00:00Z` y `--periodo-dias 180`.
2. Divide los clientes elegibles 80/20 con la semilla (los ids se ordenan antes de barajar, así el resultado
   no depende del orden de lectura).
3. Prueba k = 2…6 (recortado a `floor(entrenamiento/5)` y a las combinaciones RFM distintas) y elige el de
   mayor silhouette **solo con el entrenamiento**; ajusta log1p, escalado y K-Means con ese 80 %.
4. Aplica el modelo fijo al 20 % de evaluación y calcula sus métricas sin reajustar nada.
5. Asigna con el mismo modelo a todos los clientes elegibles para resumir los grupos.

Archivos en `--salida`:

| Archivo | Contenido |
|---|---|
| `resultado.json` | estado, origen, semilla, corte, periodo, conteos de limpieza, división, selección de k, métricas, grupos (solo agregados) |
| `asignaciones.csv` | cliente seudónimo, conjunto (entrenamiento/evaluación), grupo y RFM. **Solo local: la API no lo expone** |
| `modelo.joblib` | Pipeline entrenado (su SHA-256 queda en `resultado.json`) |

Código de salida: `0` listo, `3` datos insuficientes, `2` entrada inválida, `1` error inesperado.

## 4. Ver la división, las métricas y los grupos

```powershell
.\.venv\Scripts\python.exe -m segmentacion_clientes mostrar --salida salidas\demo_tienda_a
.\.venv\Scripts\python.exe -m segmentacion_clientes mostrar --salida salidas\demo_tienda_a --json
.\.venv\Scripts\python.exe -m segmentacion_clientes visualizar --salida salidas\demo_tienda_a
Start-Process .\salidas\demo_tienda_a\grupos.html
```

`mostrar` imprime clientes elegibles y excluidos (y por qué), tamaños de entrenamiento y evaluación, la semilla,
la silhouette de cada k probado, las métricas de los dos conjuntos y cada grupo con sus medianas.
`visualizar` genera `grupos.html` (sin dependencias externas): un gráfico por grupo (recencia contra monto,
monto en escala logarítmica, el grupo resaltado sobre el resto de la tienda) y una tabla con mediana y P25–P75.

Resultados obtenidos al probar esta guía (datos **SIMULADOS**, semilla 20261107; solo demuestran el flujo):

| Tienda | Clientes (elegibles / total) | Entrenamiento | Evaluación | k | Silhouette entr. / eval. | Davies-Bouldin entr. / eval. |
|---|---|---|---|---|---|---|
| demo_tienda_a | 216 / 260 | 172 | 44 | 6 | 0.5391 / 0.4827 | 0.6726 / 0.6824 |
| demo_tienda_b | 134 / 160 | 107 | 27 | 6 | 0.5398 / 0.4954 | 0.6830 / 0.6101 |

En ambas tiendas la silhouette sigue subiendo hasta k = 6, el mayor candidato, y el resultado lo advierte
(`k_maximo`): con otro rango podría salir otra cantidad de grupos. La separación es orientativa.

## 5. Usarlo desde la web (Reportes → Segmentación de clientes)

Requisitos: la API y el front funcionando con su configuración habitual, y el entorno `.venv` de este README
creado (la API ejecuta `IA\ANS\.venv\Scripts\python.exe`).

```powershell
# Terminal 1 (desde la raíz del repositorio): API en http://localhost:3001
Set-Location .\api
npm run dev

# Terminal 2 (desde la raíz del repositorio): front en http://localhost:3000
Set-Location .\front
npm run dev
```

1. Inicia sesión en una tienda con **plan Pro** (usa la función `aiReports`, igual que los reportes con IA) con
   un usuario que tenga `VIEW_REPORTS` **y** `ALL_BRANCHES` (Super Admin tiene ambos). Como los grupos resumen
   clientes de todas las sucursales, un usuario limitado a una sucursal recibe 403.
2. Abre `http://localhost:3000/admin/reports` y elige la pestaña **Segmentación de clientes**.
3. **Datos de demostración → "Generar demo y analizar"**: la API genera una tienda ficticia solo para tu tienda en
   `IA\ANS\salidas\web\demo\<id de tu tienda>\` y entrena (unos 5–10 s). La vista muestra el aviso amarillo
   **"Datos de demostración"** y se actualiza sola mientras dice "Analizando…".
4. Estados: `Sin analizar`, `Analizando…`, `Listo`, `Datos insuficientes`, `Error`.
5. "¿Cómo se calcula?" explica las reglas y muestra los conteos de calidad de datos.

Consultar la página **nunca entrena**: solo el botón lo hace. La API rechaza con 409 un segundo entrenamiento de
la misma tienda mientras hay uno en curso. Endpoints (todos con JWT de la tienda):
`GET /api/v1/reports/segments?source=demo|real`, `POST /api/v1/reports/segments/train`,
`DELETE /api/v1/reports/segments/demo`. La tienda sale siempre del token y del tenant del request.

Variables opcionales de la API (no hace falta tocarlas en local): `SEGMENTATION_DIR` (carpeta `IA/ANS`; por
defecto `..\IA\ANS` relativo a `api\`) y `SEGMENTATION_PYTHON` (intérprete; por defecto el de `.venv`).

## 6. Entrenar con compras reales (solo con historial suficiente)

En la misma pestaña elige **Compras reales → "Analizar compras reales"**. La API extrae en solo lectura, y
únicamente del schema de **tu** tienda, a `IA\ANS\salidas\web\real\<id de tu tienda>\entrada\`:

- `clientes.csv`: usuarios con rol Cliente o que hicieron algún pedido (id seudónimo + fecha de alta).
- `pedidos.csv`: un renglón por pedido (no por línea ni por pago): id seudónimo, cliente seudónimo, fecha,
  estado, `totalAmount` y la moneda de cobro de la tienda (`PAYMENT_CURRENCY`; los pedidos no guardan moneda).
- `devoluciones.csv`: pedido seudónimo, fecha y `totalRefunded` (solo informativo).

Los identificadores son hashes SHA-256 del id con el id de la tienda: no hay ids reales, nombres, correos,
teléfonos, direcciones ni datos de pago. Las ventas de caja sin cliente registrado (usuario "consumidor final"
del POS) se excluyen y solo se cuenta cuántas fueron. El resultado queda en `...\resultado\`, separado de la demo
(otras carpetas, otro estado), y la API rechaza cualquier `resultado.json` cuyo `tienda_id` no sea el de la
tienda que consulta.

Mínimos de **esta implementación** (no son reglas universales; están en `segmentacion_clientes\reglas.py`):
30 clientes elegibles, 8 combinaciones RFM distintas y 2 variables con variedad en el entrenamiento, y como
máximo un grupo cada 5 clientes de entrenamiento. Si no se cumplen: **"Datos insuficientes"** y no se crea modelo.

En la base demo local, la tienda `stella-demo` tiene hoy 2 clientes con compras válidas (de 7 pedidos), así que
el resultado real esperado es "Datos insuficientes".

### Reglas de los datos (iguales para real y simulado)

- Compra válida: pedido en `PROCESANDO`, `ENVIADO` o `ENTREGADO` (pago confirmado, como `PAID_STATUSES` de los
  reportes). `PENDIENTE` y `CANCELADO` no cuentan. Un pedido con devoluciones sigue contando.
- Monto **bruto**: incluye envío y descuentos; las devoluciones registradas antes del corte se informan aparte y
  **no se restan**.
- Clientes no elegibles, informados por separado: *sin compras válidas* (nunca hasta el corte) y *sin compras en
  el periodo* (solo compraron antes). No se les inventa fecha.
- Filas excluidas y contadas por motivo, sin modificar los archivos originales: duplicado exacto (se cuenta una
  vez), id de pedido repetido con datos distintos (se excluyen ambos), sin id, sin cliente, fecha inválida,
  importe vacío o no numérico, importe negativo, estado desconocido y fecha igual o posterior al corte.
- Montos extremos: se conservan; log1p los atenúa. Solo se informa cuántos clientes superan Q3 + 3·IQR.
- Monedas: si aparece más de una, la entrada se rechaza (código 2): no se suman monedas distintas.

## 7. Repetir o eliminar solo los datos simulados

```powershell
# Volver a generar (misma semilla => mismos datos)
.\.venv\Scripts\python.exe -m segmentacion_clientes simular --salida datos_demo

# Borrar únicamente carpetas marcadas como simuladas (DATOS_SIMULADOS.txt + origen "simulado")
.\.venv\Scripts\python.exe -m segmentacion_clientes limpiar-demo datos_demo salidas
```

`limpiar-demo` revisa cada carpeta indicada y sus subcarpetas directas, y solo borra las que tienen la marca
**y** `origen: simulado`. Nunca toca `salidas\web\real`. La demo de la web se borra con el botón
**"Eliminar demo"** (solo la de tu tienda).

## Limitaciones

- La separación matemática (silhouette, Davies-Bouldin) es orientativa: no prueba que los grupos sean útiles
  comercialmente ni garantiza comportamiento futuro. Con los datos simulados, k quedó en el máximo probado.
- El 80/20 divide clientes con una misma fecha de corte: no evalúa el comportamiento en fechas futuras. Eso
  requeriría otro diseño y más historial.
- No hay historial de estados de pedido: se usa el estado actual. Por eso el corte por defecto es el momento de
  la extracción; con `--corte` anterior sobre datos reales el resultado lo advierte.
- El análisis es por tienda: suma todas las sucursales. Un usuario de una sola sucursal no puede verlo.
- El modelo no se reentrena solo: se reentrena con el botón o por línea de comandos.
- El entrenamiento corre como proceso local de la API (uno por tienda a la vez). Si la API se reinicia a mitad,
  el estado queda como "Error (interrumpido)" y basta con volver a entrenar.
- `modelo.joblib` usa pickle: cárgalo solo si lo generó este módulo (`cargar_modelo_confiable` verifica el
  SHA-256 registrado). Nunca cargues modelos de terceros.
- `datos_demo\`, `salidas\` y `.venv\` están en `.gitignore`: no se suben al repositorio.
