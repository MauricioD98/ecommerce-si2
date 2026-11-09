# Reportes con IA (Text-to-SQL)

`POST /api/v1/reports/dynamic` (permiso `VIEW_REPORTS`, plan con `aiReports`). El usuario pregunta en lenguaje
natural (escrito o dictado con la Web Speech API del navegador); el modelo de Groq genera **un** `SELECT` sobre
las vistas de reportes; el servidor lo valida, resuelve los nombres y lo ejecuta en la base con permisos
limitados al ámbito del usuario. La respuesta es la tabla de resultados más la **interpretación** (zona horaria,
moneda, nombres resueltos y avisos) o una **aclaración** cuando un nombre es ambiguo.

Código: `api/src/modules/reports/` (`reports.service.ts`, `sql-guard.ts`, `report-prompt.ts`,
`report-calendar.ts`, `entity-resolver.ts`). Migraciones: `20261109120000_branch_scoped_reporting` (seguridad)
y `20261110120000_reporting_accuracy` (exactitud).

## Fechas y zona horaria

- Las tablas guardan `createdAt` como `timestamp` **sin zona, en UTC** (Prisma escribe la hora UTC desde el
  cliente; no hay `INSERT` crudos de pedidos ni devoluciones que dependan del `DEFAULT`).
- **Ninguna tienda tiene zona horaria configurada** (no existe el campo). Se usa `REPORTS_TIMEZONE` y, si no
  está o no es válida, **`America/La_Paz`** (Bolivia, UTC−4 todo el año). Una zona por tienda requeriría un
  campo en el plano de control (`tenants.timezone`).
- Las vistas exponen las fechas como `timestamptz` y la transacción del reporte fija `TimeZone` a la zona de
  la tienda: `current_date`, `date_trunc`, `::date` y los literales `'2026-11-08'` se interpretan en hora
  **local**. El prompt incluye la hora local y los rangos ya calculados de hoy, ayer, esta semana (lunes a
  domingo), semana pasada, este mes, mes pasado, este año y año pasado (`desde` incluido, `hasta` excluido).
- Los reportes fijos del panel (`report-scope.ts`, dashboard) siguen cortando los días en UTC: pendiente.

## Ventas, devoluciones y netas

Reglas reales del proyecto (`report-scope.ts`, `returns.service.ts`, `payment-settlement.service.ts`):

| Término | Definición |
|---|---|
| Venta (pagada) | Pedido con `status` `PROCESANDO`, `ENVIADO` o `ENTREGADO` (columna `es_venta`). |
| Pendiente | `status = 'PENDIENTE'` (sin pagar). |
| Cancelado | `status = 'CANCELADO'` (anulado o vencido). Nunca tiene devoluciones. |
| Devolución | Filas de `returns`/`return_items`. Solo sobre ventas con pago `COMPLETADO`; parcial por línea (nunca más de lo vendido); se reembolsa al **precio unitario histórico** de la línea. No cambia el `status` del pedido: cuando se devuelve todo, `estado_pago` pasa a `REEMBOLSADO`. El envío no se reembolsa. |
| Ventas brutas | `sum(total_amount)` de las ventas (incluye envío; el descuento de trabajador ya está restado). Por producto: `sum(subtotal)` / `sum(cantidad)`, sin envío. |
| Devoluciones | `monto_devuelto` (por pedido o por línea, atribuido a la **venta original**) o la vista `devoluciones` (por la **fecha** y la **sucursal que recibió** la devolución). |
| Ventas netas | `total_neto = total_amount − monto_devuelto`; por línea `subtotal_neto`, `cantidad_neta`. |

Las devoluciones se agregan por pedido o por línea **antes** de unirse, y el pago es único por pedido: un
pedido con varios productos, un pago y varias devoluciones parciales es siempre una fila con su total exacto.

`REEMBOLSADO` también aparece cuando un pago llegó tarde a un pedido ya cancelado y se reembolsó: no es una
devolución, por eso las devoluciones se cuentan con `monto_devuelto`/`devoluciones`, nunca con `estado_pago`.

## Moneda

Todos los importes (pedidos, líneas, devoluciones) están en la **moneda del catálogo** (`PAYMENT_CURRENCY`,
`BOB` en Bolivia): Stripe cobra `totalAmount` en esa moneda y el front muestra «Bs». El sistema **no guarda
moneda por pedido ni tipo de cambio**: en los cobros con USDT el cliente envía «el equivalente» y `payments`
repite el total en Bs con la etiqueta `USDT`. Por eso `moneda_cobro` describe el medio de cobro, no la moneda
del importe; los reportes no convierten nada y avisan cuando hay ventas cobradas en otra moneda. Si
`PAYMENT_CURRENCY` cambiara en el futuro, los pedidos anteriores no lo registran.

## Nombres de sucursales, productos y categorías

El modelo no escribe nombres en el SQL: usa marcadores `{{sucursal:texto}}`, `{{producto:texto}}` y
`{{categoria:texto}}`. El servidor los resuelve **dentro del ámbito del usuario** (consulta las opciones con el
mismo rol y schema que el reporte; un usuario de una sucursal solo «ve» la suya) y los reemplaza por el id:

1. igual sin mayúsculas, tildes ni palabras genéricas («sucursal», «tienda»…), o el SKU exacto;
2. todas las palabras dichas aparecen en el nombre («norte» → «Centro Norte»);
3. aproximado por errores de dictado («yin mom» → «Jean Mom»), solo con un candidato claro; se avisa.

Si hay varias coincidencias o ninguna, **no se ejecuta la consulta**: la respuesta trae `clarification` con el
mensaje y las opciones, y el panel las muestra como botones que vuelven a preguntar precisando el nombre.
Límite: se leen hasta 10 000 opciones por tipo.

## Seguridad (etapa 1)

- Validador sobre el árbol sintáctico real de PostgreSQL (`libpg-query`): solo listas permitidas de vistas,
  funciones, tipos y nodos; sin límite de tablas; los literales no se inspeccionan.
- Ejecución en `report_runtime.run_report()` (SECURITY DEFINER) con el rol global `stella_report_runner`, sin
  permisos propios: en cada petición se le concede USAGE/SELECT solo sobre `<schema>_reporting`
  (ALL_BRANCHES) o `rb_<md5>` (una sucursal, filtro por id literal), dentro de una transacción de solo lectura
  que termina siempre en ROLLBACK. Dentro de la función PostgreSQL impide cambiar de rol.
- Sin roles por tienda ni por sucursal (Neon permite 500 roles por rama).

## Pruebas

`api/test/acceptance/reports-dynamic-scope.spec.ts` (seguridad) y `reports-accuracy.spec.ts` (exactitud), con
una base PostgreSQL local desechable cuyo dueño **no** sea superusuario y tenga `CREATEROLE`:

```
ACCEPTANCE_DATABASE_URL=postgresql://<usuario>@127.0.0.1:<puerto>/<base_con_test> node test/acceptance/run.js reports-
```

Las pruebas con **SQL simulado** reemplazan solo la llamada al modelo. Las de **Groq real** corren únicamente
con `GROQ_TEST_API_KEY` (y usan solo datos sintéticos).

## Despliegue

Primero el código, después las migraciones `20261109120000` y `20261110120000` (en cada tienda,
`npm run migrate:all`). Sin ellas, los reportes con IA responden 503 sin ejecutar nada; el resto de la app no
cambia.
