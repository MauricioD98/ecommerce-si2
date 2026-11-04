# Compra resistente a fallos: operación y despliegue

Para quien despliega y opera la API, la web y la app móvil de Stella Femme. Resume los contratos, las políticas y los pasos que no se deducen del código.

## Modelo

**Inventario.** `ProductInventory.stock` son unidades disponibles. Una unidad física está disponible, reservada o vendida una sola vez:

```
stock inicial = stock actual + reservas ACTIVE + reservas CONSUMED de órdenes vivas
```

No hay un contador "reservado" aparte. `Product.stock` es un agregado solo para mostrar y nunca autoriza una venta. Las mermas (`damagedStock`) no se venden.

**Orden único de bloqueos**, en todos los flujos (`common/checkout/tx.util.ts`):

1. carrito
2. orden
3. inventario, por producto + sucursal + talla
4. producto, siempre al final (`FOR NO KEY UPDATE`)

**Exactamente una vez.** Cada efecto de stock inserta primero en `inventory_movements` con un `effectId` único. Si ya existe, no se repite.

## Contrato de compra

| Operación | Contrato |
|---|---|
| `PUT /cart` | Reemplaza el carrito en una transacción aplicando solo diferencias. Devuelve `version`. |
| `POST /orders` | Exige `Idempotency-Key` y `cartVersion`; `expectedTotal` es opcional. Claim, reservas, orden y resultado se confirman en una transacción. |
| `GET /orders/attempts/:key` | Estado de un intento propio. Un 404 no prueba que un POST en vuelo no vaya a completarse. |
| `POST /payments/create-intent` | Recupera o crea el intento durable. Importe y moneda los fija el servidor. |
| `POST /payments/confirm` | Solo reconcilia con evidencia de Stripe. `processing` y `requires_action` responden 409 `PAYMENT_PENDING`. |
| `PUT /branches/:id/inventory/:productId` | Exige `operationId` y `expectedVersion` por talla. Si cambió: 409 con valor leído, actual y propuesto. |
| `GET /checkout-ops/metrics` | Salud de la compra en la tienda. Requiere `VIEW_REPORTS`. |

Códigos estables en `code`: `OUT_OF_STOCK`, `CART_VERSION_CONFLICT`, `PRICE_CHANGED`, `ATTEMPT_IN_PROGRESS`, `PAYMENT_PENDING`, `RESERVATION_EXPIRED`, `IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_KEY_REQUIRED`, `ATTEMPT_NOT_FOUND`, `ORDER_ALREADY_PAID`, `ORDER_NOT_PAYABLE`, `PAYMENT_MISMATCH`, `PAYMENT_SIMULATION_DISABLED`, `INVENTORY_VERSION_CONFLICT`, `PROVIDER_UNAVAILABLE`.

## Políticas

Son decisiones comerciales, configurables por variable de entorno (ver `api/.env.example`). Conviene que el negocio las revise.

| Situación | Política por defecto |
|---|---|
| Carrito sin actividad | La reserva vence a 1 h, la regla que ya existía. |
| Orden con tarjeta o QR sin pagar | Vence a 1 h. Al abrir el pago se garantizan al menos 15 min. |
| Medio manual sin comprobante | Vence a 24 h. Con comprobante pendiente no vence: decide la tienda. |
| Stripe responde `processing` o no responde | No se libera. La reserva se extiende 6 h y se registra `PAYMENT_UNCERTAIN`. |
| Cobro tardío de una orden ya liberada | No se confirma la entrega. Reembolso idempotente con reversión de transferencia y comisión. No se intenta reservar de nuevo. |
| Segundo cobro de una orden ya pagada | Reembolso (`DUPLICATE_CHARGE`). |
| Reembolso que falla 5 veces | `MANUAL_REVIEW`, gestión humana. |
| Clave de idempotencia de Stripe | Se reutiliza durante 23 h. Después se busca el PI por metadata y no se crea otro a ciegas. |

## Despliegue (expand/contract)

Las migraciones nuevas se aplican solas al arrancar con `npm run migrate:all`.

1. **Probar la migración con una copia de producción.** Revisar `operational_issues` en cada tienda (`LEGACY_*`). La migración audita, no corrige. Si hay `LEGACY_DUPLICATE_TXID`, el índice único de TxID no se crea en esa tienda hasta resolverlo a mano.
2. **Registrar en Stripe** los eventos nuevos del webhook: `payment_intent.processing`, `payment_intent.requires_action`, `payment_intent.canceled` y `charge.refunded`.
3. **Desplegar la API.** Regenerar los clientes con `npx prisma generate` y `npx prisma generate --config prisma.control.config.ts`. Desde aquí, los clientes sin `Idempotency-Key` reciben 400 `IDEMPOTENCY_KEY_REQUIRED`: las apps viejas deben actualizar. Por eso API y web se despliegan juntas.
4. **Desplegar la web.** El service worker v9 elimina al activarse las cachés privadas de la v8.
5. **Publicar la app móvil.** Las versiones instaladas no pueden comprar hasta actualizar.
6. **Vigilar** `GET /checkout-ops/metrics`, los logs `Alerta de compra` y `provider_event_inbox` con estado `UNRESOLVED` o `DEAD`.

**Rollback.** No volver a una API anterior: ignoraría las reservas, el inbox y los intentos, y reabriría los bypass. Si hay un problema grave:

1. Pausar el checkout en el borde o en el balanceador.
2. Dejar corriendo los trabajos en segundo plano para que converjan pagos y reservas.
3. Corregir hacia adelante.

Las migraciones solo agregan, así que una API nueva corregida puede usar los datos ya escritos.

## Métricas que requieren atención

| Métrica | Significado |
|---|---|
| `uncertainAttempts` | Intentos de pago abiertos sin cambios hace más de 15 min. |
| `expiredReservations` | Reservas vencidas sin barrer: el cron está atrasado. |
| `pendingCompensations` | Reembolsos sin confirmar o en revisión manual. |
| `outboxLag`, `outboxDead` | Correos o avisos atrasados o agotados. |
| `paidWithoutConsistentOrder` | Pago completado con orden incoherente. Debe ser 0. |
| `aggregateDrift` | Productos con agregado desfasado. No afecta las ventas. |
| `inboxBacklog` | Webhooks sin procesar hace más de 15 min. |

Los logs llevan tienda, intento, orden y evento. No registran tarjetas, secretos, tokens ni `client_secret`.

## Pruebas

```bash
# PostgreSQL local desechable: la base se BORRA en cada corrida. Se exige host local y "test" en el nombre.
export ACCEPTANCE_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:55432/stella_acceptance_test
cd api
npm run test:acceptance             # API, concurrencia, pagos con Stripe falso, móvil

# Navegador real: build de producción del front con NEXT_PUBLIC_API_URL=http://127.0.0.1:39200/api/v1
export PLAYWRIGHT_MODULE=/ruta/a/node_modules/playwright FRONT_DIR=/ruta/a/front
npm run test:acceptance pwa

# Stripe real, solo modo test: se niega a correr con otra clave
STRIPE_TEST_SECRET_KEY=sk_test_... npm run test:acceptance stripe-test
```

Las pruebas usan `node:test` sobre JS compilado porque NestJS 12 se publica como ESM y Jest no lo carga en este proyecto. El arnés fija todas las variables capaces de alcanzar un servicio externo, ya que `api/.env` apunta a una base remota.

## Limitaciones conocidas

- **Tarjeta en la app móvil.** La app no integra un SDK de Stripe: su formulario de tarjeta no procesa datos reales. Fuera de `ALLOW_SIMULATED_PAYMENTS` no puede completar un pago con tarjeta. Falta integrar `@stripe/stripe-react-native` (requiere development build) o un checkout alojado, con su deep link de retorno y 3DS.
- **Retención.** No hay un trabajo que purgue `checkout_attempts`, `provider_event_inbox`, `outbox_events` ni `inventory_movements`. Hay que definir el plazo con el negocio. Los intentos deben conservarse al menos durante el horizonte de reintentos de los clientes (3 días).
- **Alta de sucursal.** `BranchesService` crea inventario inicial sin movimiento ni recálculo del agregado. No autoriza ventas, pero aparece en `aggregateDrift`.
