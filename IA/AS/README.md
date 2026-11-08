# IA/AS — Pronóstico de ventas con aprendizaje supervisado

Estima cuántas **unidades se venderán la próxima semana completa (lunes a domingo, UTC)** por
**tienda → sucursal → producto → talla**. Cada modelo se entrena con los datos de **una sola tienda**.

- `IA/AS` = aprendizaje supervisado (este módulo). `IA/ANS` queda reservado para aprendizaje no supervisado.
- Modelo: `Pipeline` de scikit-learn (`OneHotEncoder(handle_unknown="ignore")` + `RandomForestRegressor`, semilla fija).
- Línea base de comparación: promedio de las últimas 4 semanas (y, como referencia, la semana anterior).
- Métrica: **MAE** (error absoluto medio, en unidades). No es un porcentaje de precisión.
- División **cronológica 80/20 por semanas**: las primeras `floor(n*8/10)` semanas objetivo entrenan, el resto prueba.

> **Datos simulados ≠ datos reales.** El generador produce ventas ficticias y reproducibles para demostrar el
> flujo. Una buena métrica sobre ellas **no** demuestra precisión con ventas reales.

---

## 1. Instalación (Windows PowerShell)

Desde la raíz del repositorio (`ecommerce-si2`):

```powershell
Set-Location .\IA\AS
python --version                      # probado con Python 3.13.16
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Activar el entorno es opcional; todos los comandos de esta guía usan la ruta directa
`.\.venv\Scripts\python.exe`, que funciona aunque PowerShell bloquee los scripts. Si aun así quieres
activarlo y aparece "la ejecución de scripts está deshabilitada", habilítalo **solo para esta ventana**:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

Pruebas del módulo (unas 30 pruebas, ~30 s):

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -t .
```

## 2. Generar datos simulados (demo aislada)

```powershell
.\.venv\Scripts\python.exe -m pronostico_ventas simular --salida datos_demo
```

Crea dos tiendas **ficticias**, cada una en su carpeta: `datos_demo\demo_tienda_a` (3 sucursales, 11
productos) y `datos_demo\demo_tienda_b` (2 sucursales, 9 productos). Cada carpeta tiene
`DATOS_SIMULADOS.txt` y `origen.json` con `"origen": "simulado"`. No hay clientes ni datos personales,
no se toca ninguna base de datos ni Stripe.

- Semilla por defecto `20261107` (`--semilla N` para cambiarla). Misma semilla ⇒ mismos archivos.
- Fechas fijas: 117 semanas, del lunes 2024-08-05 al domingo 2026-11-01; corte simulado 2026-11-02 00:00 UTC.
- Incluye pedidos cancelados y pendientes, devoluciones, un producto lanzado a mitad del periodo, uno con
  solo 2 semanas de historial, uno sin ventas y uno discontinuado.

## 3. Preparar el dataset, entrenar y evaluar (una tienda por vez)

```powershell
.\.venv\Scripts\python.exe -m pronostico_ventas entrenar --entrada datos_demo\demo_tienda_a --salida salidas\demo_tienda_a
.\.venv\Scripts\python.exe -m pronostico_ventas entrenar --entrada datos_demo\demo_tienda_b --salida salidas\demo_tienda_b
```

Cada comando construye el panel semanal, divide 80/20, ajusta hiperparámetros con validación
cronológica **dentro del 80 %**, evalúa una sola vez en el 20 % final, reentrena con todas las semanas
y guarda en `--salida`:

| Archivo | Contenido |
|---|---|
| `resultado.json` | estado, origen, semilla, versión, fechas, división, métricas, hiperparámetros, pronóstico |
| `dataset.csv` | panel con variables, etiqueta y columna `conjunto` (historial / entrenamiento / prueba / pronostico) |
| `modelo.joblib` | modelo publicado (su SHA-256 queda en `resultado.json`) |

Código de salida: `0` listo, `3` datos insuficientes, `2` entrada inválida, `1` error inesperado.

## 4. Consultar resultados

```powershell
.\.venv\Scripts\python.exe -m pronostico_ventas mostrar --salida salidas\demo_tienda_a --limite 15
.\.venv\Scripts\python.exe -m pronostico_ventas mostrar --salida salidas\demo_tienda_a --json
```

Muestra el periodo pronosticado, la fecha de corte, semanas y filas de entrenamiento/prueba con sus
fechas, MAE del modelo y de las líneas base, si supera la línea base principal, la ubicación del modelo y
las filas del pronóstico. Las unidades se muestran como entero más cercano (`.5` hacia arriba) y, entre
paréntesis, con 2 decimales.

Resultados obtenidos al probar esta guía (datos **SIMULADOS**, semilla 20261107; solo demuestran el flujo):

| Tienda | Semanas objetivo | Entrenamiento | Prueba | MAE modelo | MAE prom. 4 semanas | MAE semana anterior |
|---|---|---|---|---|---|---|
| demo_tienda_a | 113 | 90 sem. / 5795 filas (2024-09-02 a 2026-05-24) | 23 sem. / 1518 filas (2026-05-25 a 2026-11-01) | 1.198 | 1.2884 | 1.5441 |
| demo_tienda_b | 113 | 90 sem. / 3683 filas | 23 sem. / 1012 filas | 0.8871 | 0.9476 | 1.1522 |

### Cómo leer el MAE

MAE = promedio de `|unidades reales − unidades previstas|` por fila (sucursal × producto × talla × semana)
en el 20 % de prueba. Un MAE de 1.2 significa que, en promedio, la estimación se equivoca en 1.2 unidades
por fila. Compáralo siempre con la línea base sobre **las mismas filas**: si el modelo no la mejora, el
informe lo dice (`supera_linea_base_principal: false`).

## 5. Usarlo desde la web (Reportes → Pronóstico de ventas)

Requisitos: la API y el front funcionando con su configuración habitual, y el entorno `.venv` de este
README creado (la API ejecuta `IA\AS\.venv\Scripts\python.exe`).

```powershell
# Terminal 1 (desde la raíz del repositorio): API en http://localhost:3001
Set-Location .\api
npm run dev

# Terminal 2 (desde la raíz del repositorio): front en http://localhost:3000
Set-Location .\front
npm run dev
```

1. Inicia sesión en una tienda con **plan Pro** (la función usa `aiReports`, igual que los reportes con IA)
   con un usuario que tenga `VIEW_REPORTS`. Para entrenar o borrar la demo hace falta además `ALL_BRANCHES`
   (Super Admin lo tiene).
2. Abre `http://localhost:3000/admin/reports` y elige la pestaña **Pronóstico de ventas**.
3. **Demo simulada → "Generar demo y entrenar"**: la API genera una tienda ficticia solo para tu tienda en
   `IA\AS\salidas\web\demo\<id de tu tienda>\` y entrena (unos 15–20 s). La vista muestra un aviso amarillo
   de **DATOS SIMULADOS** y se actualiza sola mientras dice "Entrenando…".
4. Estados posibles: `Sin entrenar`, `Entrenando…`, `Listo`, `Sin datos suficientes`, `Error`.

Consultar la página **nunca entrena**; solo el botón lo hace, y la API rechaza (409) un segundo
entrenamiento de la misma tienda mientras hay uno en curso. Endpoints (todos con JWT de la tienda):
`GET /api/v1/reports/forecast?source=demo|real`, `POST /api/v1/reports/forecast/train`,
`DELETE /api/v1/reports/forecast/demo`. La tienda sale siempre del token y del tenant del request.

Variables opcionales de la API (no hace falta tocarlas en local): `FORECAST_DIR` (carpeta `IA/AS`;
por defecto `..\IA\AS` relativo a `api\`) y `FORECAST_PYTHON` (intérprete; por defecto el de `.venv`).

## 6. Entrenar con ventas reales (solo con historial suficiente)

En la misma pestaña elige **Ventas reales → "Entrenar con ventas reales"**. La API extrae, en solo
lectura y únicamente del schema de **tu** tienda, las líneas de pedido (fecha, estado, sucursal, producto,
talla, cantidad), devoluciones, productos y sucursales —sin clientes, correos, direcciones ni pagos— a
`IA\AS\salidas\web\real\<id de tu tienda>\entrada\` y entrena en `...\resultado\`. Nunca se mezcla con la
demo: son carpetas, estados y resultados separados, y cada resultado se rechaza si su `tienda_id` no es
el de la tienda que consulta.

Mínimo para entrenar (si no se cumple, el estado es **Sin datos suficientes** y no se crea modelo):

- 10 semanas objetivo elegibles (8 de entrenamiento + 2 de prueba) y 30 filas de entrenamiento.
- Una fila es elegible si su serie (sucursal + producto + talla) tiene 4 semanas completas observadas antes.
- Solo cuentan semanas **completas**: las ventas de la semana en curso se descartan.

Productos con 1–3 semanas de historial reciben una **estimación alternativa** (promedio de esas semanas),
marcada como tal y nunca atribuida al modelo; sin historial: "Datos insuficientes".

### Reglas del dataset (iguales para real y simulado)

- Venta válida: pedidos en `PROCESANDO`, `ENVIADO` o `ENTREGADO` (pago confirmado, como `PAID_STATUSES`
  de los reportes). `PENDIENTE` y `CANCELADO` no suman.
- Devoluciones: **no** se restan de la etiqueta (sería información futura); se informan aparte en la
  semana en que se registraron, atribuidas a la sucursal que vendió.
- Una semana sin ventas dentro del rango observado de la serie es un 0 real; antes de la primera línea de
  pedido de la serie la semana es desconocida y no se rellena. Productos o sucursales inactivos terminan en
  su última línea (no existe fecha de baja).
- Variables (solo semanas anteriores a la objetivo): ventas de la semana anterior, suma de 2 y 4 semanas,
  promedio de hasta 8, semanas de historial, totales de la sucursal y de la tienda la semana anterior,
  calendario (semana ISO seno/coseno, mes), categoría, sucursal y talla.

## 7. Repetir o eliminar solo los datos simulados

```powershell
# Volver a generar (sobrescribe la demo con los mismos datos si la semilla es la misma)
.\.venv\Scripts\python.exe -m pronostico_ventas simular --salida datos_demo

# Borrar únicamente carpetas marcadas como simuladas (DATOS_SIMULADOS.txt + origen "simulado")
.\.venv\Scripts\python.exe -m pronostico_ventas limpiar-demo datos_demo salidas
```

`limpiar-demo` revisa cada carpeta indicada y sus subcarpetas directas y solo borra las que tienen la
marca **y** `origen: simulado`; nunca toca `salidas\web\real`. La demo de la web se borra con el botón
**"Eliminar demo"** (solo la de tu tienda).

## Limitaciones

- Se pronostican **ventas observadas**, no demanda: si faltó stock, la venta pudo ser menor que la demanda.
- No existe historial fiable de precio, promociones ni stock por fecha (`inventory_movements` existe solo
  desde 2026-11-03), así que el modelo no los usa. Tampoco hay historial de estados de pedido: se usa el
  estado actual (un pedido cancelado después se excluye de su semana).
- La variante es la talla de la línea del pedido; el color no se guarda por línea.
- Las métricas son del modelo entrenado con el 80 % y evaluado una vez sobre el 20 %; el pronóstico
  publicado usa el mismo modelo reentrenado con todas las semanas elegibles.
- No se calcula ni se muestra confianza o probabilidad.
- El entrenamiento corre como proceso local de la API (una ejecución por tienda a la vez). Si la API se
  reinicia a mitad, el estado queda como "Error (interrumpido)" y basta con volver a entrenar.
- `modelo.joblib` usa pickle: cárgalo solo si lo generó este módulo (`cargar_modelo_confiable` verifica el
  SHA-256 registrado). Nunca cargues modelos de terceros.
- `datos_demo\`, `salidas\` y `.venv\` están en `.gitignore`: no se suben al repositorio.
