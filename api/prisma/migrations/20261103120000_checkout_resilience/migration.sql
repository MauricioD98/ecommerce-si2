-- Compra resistente a fallos: reservas explícitas, libro de movimientos, idempotencia de checkout,
-- intentos de pago durables, compensaciones, outbox y anomalías operativas.
--
-- Fase EXPAND: compatible con el código anterior salvo por el contrato nuevo de POST /orders.
-- ProductInventory.stock sigue siendo "unidades disponibles": los carritos actuales YA descontaron su
-- stock, así que el backfill registra sus reservas SIN volver a descontar nada. Las inconsistencias se
-- registran en operational_issues; ninguna se corrige destructivamente ni se inventa stock.

-- ── Tipos ───────────────────────────────────────────────────────────────────────────────────────
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'RELEASED', 'EXPIRED');
CREATE TYPE "CheckoutAttemptStatus" AS ENUM ('IN_PROGRESS', 'SUCCEEDED', 'REJECTED');
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('CREATED', 'OPEN', 'SUCCEEDED', 'CANCELED', 'ABANDONED');
CREATE TYPE "CompensationStatus" AS ENUM ('REQUESTED', 'REFUND_PENDING', 'REFUNDED', 'MANUAL_REVIEW');
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'DONE', 'DEAD');

-- ── Columnas nuevas ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "product_inventories" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "carts" ADD COLUMN "activeUserId" TEXT, ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "orders"
    ADD COLUMN "paymentExpiresAt" TIMESTAMP(3),
    ADD COLUMN "cancelRequestedAt" TIMESTAMP(3),
    ADD COLUMN "reconciliationStatus" TEXT;

-- ── Tablas ──────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE "operational_issues" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'WARN',
    "dedupeKey" TEXT,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "operational_issues_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "operational_issues_dedupeKey_key" ON "operational_issues"("dedupeKey");
CREATE INDEX "operational_issues_type_resolvedAt_idx" ON "operational_issues"("type", "resolvedAt");

CREATE TABLE "stock_reservations" (
    "id" TEXT NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "quantity" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "cartId" TEXT,
    "cartItemId" TEXT,
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stock_reservations_quantity_positive" CHECK ("quantity" > 0)
);
CREATE UNIQUE INDEX "stock_reservations_cartItemId_key" ON "stock_reservations"("cartItemId");
CREATE INDEX "stock_reservations_status_expiresAt_idx" ON "stock_reservations"("status", "expiresAt");
CREATE INDEX "stock_reservations_cartId_idx" ON "stock_reservations"("cartId");
CREATE INDEX "stock_reservations_orderId_idx" ON "stock_reservations"("orderId");
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "carts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_cartItemId_fkey" FOREIGN KEY ("cartItemId") REFERENCES "cart_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "inventory_movements" (
    "id" TEXT NOT NULL,
    "effectId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "stockDelta" INTEGER NOT NULL DEFAULT 0,
    "damagedDelta" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "inventory_movements_effectId_key" ON "inventory_movements"("effectId");
CREATE INDEX "inventory_movements_productId_branchId_size_idx" ON "inventory_movements"("productId", "branchId", "size");
CREATE INDEX "inventory_movements_refType_refId_idx" ON "inventory_movements"("refType", "refId");

CREATE TABLE "checkout_attempts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "status" "CheckoutAttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "cartId" TEXT,
    "cartVersion" INTEGER,
    "orderId" TEXT,
    "resultCode" TEXT,
    "resultMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "checkout_attempts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "checkout_attempts_orderId_key" ON "checkout_attempts"("orderId");
CREATE UNIQUE INDEX "checkout_attempts_userId_operation_key_key" ON "checkout_attempts"("userId", "operation", "key");
-- Una revisión de carrito se consume una sola vez, aunque lleguen claves distintas
CREATE UNIQUE INDEX "checkout_attempts_cart_revision_once"
    ON "checkout_attempts"("cartId", "cartVersion")
    WHERE "status" = 'SUCCEEDED' AND "cartId" IS NOT NULL AND "cartVersion" IS NOT NULL;
ALTER TABLE "checkout_attempts" ADD CONSTRAINT "checkout_attempts_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "payment_attempts" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'STRIPE',
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'CREATED',
    "providerStatus" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "destinationAccount" TEXT,
    "feeAmountMinor" INTEGER,
    "idempotencyKey" TEXT NOT NULL,
    "stripePaymentIntentId" TEXT,
    "livemode" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_attempts_amount_positive" CHECK ("amountMinor" > 0)
);
CREATE UNIQUE INDEX "payment_attempts_idempotencyKey_key" ON "payment_attempts"("idempotencyKey");
CREATE UNIQUE INDEX "payment_attempts_stripePaymentIntentId_key" ON "payment_attempts"("stripePaymentIntentId");
CREATE UNIQUE INDEX "payment_attempts_orderId_attemptNumber_key" ON "payment_attempts"("orderId", "attemptNumber");
CREATE INDEX "payment_attempts_status_updatedAt_idx" ON "payment_attempts"("status", "updatedAt");
-- Como máximo un intento abierto por orden (web y móvil simultáneos comparten el mismo)
CREATE UNIQUE INDEX "payment_attempts_one_open_per_order"
    ON "payment_attempts"("orderId") WHERE "status" IN ('CREATED', 'OPEN');
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "payment_compensations" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentIntentId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "CompensationStatus" NOT NULL DEFAULT 'REQUESTED',
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "refundId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payment_compensations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payment_compensations_paymentIntentId_key" ON "payment_compensations"("paymentIntentId");
CREATE INDEX "payment_compensations_status_idx" ON "payment_compensations"("status");
ALTER TABLE "payment_compensations" ADD CONSTRAINT "payment_compensations_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "outbox_events_dedupeKey_key" ON "outbox_events"("dedupeKey");
CREATE INDEX "outbox_events_status_nextAttemptAt_idx" ON "outbox_events"("status", "nextAttemptAt");

CREATE INDEX "orders_status_paymentExpiresAt_idx" ON "orders"("status", "paymentExpiresAt");

-- ── Auditoría de datos heredados (antes de las restricciones) ───────────────────────────────────
INSERT INTO "operational_issues" ("id", "type", "severity", "dedupeKey", "details")
SELECT gen_random_uuid()::text, 'LEGACY_NEGATIVE_STOCK', 'ERROR', 'legacy-negative-stock:' || "id",
       jsonb_build_object('inventoryId', "id", 'productId', "productId", 'branchId', "branchId", 'size', "size", 'stock', "stock", 'damagedStock', "damagedStock")
FROM "product_inventories" WHERE "stock" < 0 OR "damagedStock" < 0;

INSERT INTO "operational_issues" ("id", "type", "severity", "dedupeKey", "details")
SELECT gen_random_uuid()::text, 'LEGACY_AGGREGATE_MISMATCH', 'WARN', 'legacy-aggregate:' || p."id",
       jsonb_build_object('productId', p."id", 'productStock', p."stock", 'inventorySum', COALESCE(s.total, 0))
FROM "products" p
LEFT JOIN (SELECT "productId", SUM("stock")::int total FROM "product_inventories" GROUP BY "productId") s ON s."productId" = p."id"
WHERE p."stock" <> COALESCE(s.total, 0);

-- Filas heredadas negativas no se tocan: NOT VALID exige la regla solo a las escrituras nuevas
ALTER TABLE "product_inventories" ADD CONSTRAINT "product_inventories_stock_non_negative" CHECK ("stock" >= 0) NOT VALID;
ALTER TABLE "product_inventories" ADD CONSTRAINT "product_inventories_damaged_non_negative" CHECK ("damagedStock" >= 0) NOT VALID;
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_quantity_positive" CHECK ("quantity" > 0) NOT VALID;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_quantity_positive" CHECK ("quantity" > 0) NOT VALID;

-- ── Backfill: carrito activo único ──────────────────────────────────────────────────────────────
-- El más reciente de cada usuario queda como activo. Los duplicados conservan sus ítems, pero sin
-- activeUserId: el barrido libera su stock (ver backfill de reservas, que los deja ya vencidos).
WITH ranked AS (
    SELECT "id", "userId", ROW_NUMBER() OVER (PARTITION BY "userId" ORDER BY "updatedAt" DESC, "createdAt" DESC, "id") AS rn
    FROM "carts" WHERE "checkout" = false
)
UPDATE "carts" c SET "activeUserId" = r."userId" FROM ranked r WHERE c."id" = r."id" AND r.rn = 1;
CREATE UNIQUE INDEX "carts_activeUserId_key" ON "carts"("activeUserId");

INSERT INTO "operational_issues" ("id", "type", "severity", "dedupeKey", "details")
SELECT gen_random_uuid()::text, 'LEGACY_DUPLICATE_ACTIVE_CART', 'WARN', 'legacy-duplicate-cart:' || c."id",
       jsonb_build_object('cartId', c."id", 'userId', c."userId", 'items', (SELECT COUNT(*) FROM "cart_items" i WHERE i."cartId" = c."id"))
FROM "carts" c WHERE c."checkout" = false AND c."activeUserId" IS NULL;

-- ── Backfill: reservas de carritos existentes, SIN volver a descontar ───────────────────────────
INSERT INTO "stock_reservations" ("id", "status", "quantity", "expiresAt", "userId", "productId", "branchId", "size", "cartId", "cartItemId", "updatedAt")
SELECT gen_random_uuid()::text, 'ACTIVE', i."quantity",
       CASE WHEN c."activeUserId" IS NULL THEN CURRENT_TIMESTAMP ELSE c."updatedAt" + INTERVAL '1 hour' END,
       c."userId", i."productId", i."branchId", i."size", c."id", i."id", CURRENT_TIMESTAMP
FROM "cart_items" i
JOIN "carts" c ON c."id" = i."cartId"
JOIN "product_inventories" pi ON pi."productId" = i."productId" AND pi."branchId" = i."branchId" AND pi."size" = i."size"
WHERE c."checkout" = false AND i."quantity" > 0 AND i."branchId" IS NOT NULL AND i."size" IS NOT NULL;

-- Sin sucursal/talla no hay inventario al que atribuirles una reserva: la línea queda sin reserva y
-- el checkout la trata como una venta nueva con descuento atómico. No se devuelve stock que no se sabe de dónde salió.
INSERT INTO "operational_issues" ("id", "type", "severity", "dedupeKey", "details")
SELECT gen_random_uuid()::text, 'LEGACY_CART_ITEM_UNRESERVED', 'WARN', 'legacy-unreserved:' || i."id",
       jsonb_build_object('cartItemId', i."id", 'cartId', i."cartId", 'productId', i."productId", 'branchId', i."branchId", 'size', i."size", 'quantity', i."quantity")
FROM "cart_items" i
JOIN "carts" c ON c."id" = i."cartId"
LEFT JOIN "stock_reservations" r ON r."cartItemId" = i."id"
WHERE c."checkout" = false AND r."id" IS NULL;

INSERT INTO "operational_issues" ("id", "type", "severity", "dedupeKey", "details")
SELECT gen_random_uuid()::text, 'LEGACY_CLOSED_CART_WITH_ITEMS', 'WARN', 'legacy-closed-cart:' || c."id",
       jsonb_build_object('cartId', c."id", 'userId', c."userId", 'items', COUNT(i."id"))
FROM "carts" c JOIN "cart_items" i ON i."cartId" = c."id"
WHERE c."checkout" = true GROUP BY c."id";

-- ── Backfill: órdenes pendientes e intentos de pago ─────────────────────────────────────────────
-- Plazo de gracia de 24 h desde el despliegue: nada vence por sorpresa al migrar.
UPDATE "orders" SET "paymentExpiresAt" = CURRENT_TIMESTAMP + INTERVAL '24 hours'
WHERE "status" = 'PENDIENTE' AND "paymentStatus" IN ('PENDIENTE', 'FALLIDO') AND "source" = 'WEB';

INSERT INTO "payment_attempts" ("id", "orderId", "userId", "attemptNumber", "status", "amountMinor", "currency", "idempotencyKey", "stripePaymentIntentId", "updatedAt")
SELECT gen_random_uuid()::text, p."orderId", p."userId", 1, 'OPEN', ROUND(p."amount" * 100)::int, LOWER(p."currency"),
       'legacy-' || p."id", p."transactionId", CURRENT_TIMESTAMP
FROM "payments" p
WHERE p."status" <> 'COMPLETADO' AND p."transactionId" LIKE 'pi\_%' AND p."amount" > 0;

-- ── Una referencia de pago manual no paga dos pedidos ───────────────────────────────────────────
INSERT INTO "operational_issues" ("id", "type", "severity", "dedupeKey", "details")
SELECT gen_random_uuid()::text, 'LEGACY_DUPLICATE_TXID', 'ERROR', 'legacy-txid:' || LOWER("txId"),
       jsonb_build_object('txId', "txId", 'orders', jsonb_agg("orderId"))
FROM "payment_proofs" WHERE "txId" IS NOT NULL AND "status" <> 'RECHAZADO'
GROUP BY LOWER("txId"), "txId" HAVING COUNT(*) > 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "payment_proofs" WHERE "txId" IS NOT NULL AND "status" <> 'RECHAZADO'
    GROUP BY LOWER("txId") HAVING COUNT(*) > 1
  ) THEN
    CREATE UNIQUE INDEX "payment_proofs_txid_once" ON "payment_proofs"(LOWER("txId"))
      WHERE "txId" IS NOT NULL AND "status" <> 'RECHAZADO';
  END IF;
END $$;
