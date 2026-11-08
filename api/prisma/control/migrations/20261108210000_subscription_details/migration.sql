-- Detalle de la suscripción de cada tienda copiado de Stripe (lo escribe SubscriptionsService.syncTenant).
-- Solo agrega columnas: las existentes quedan en NULL / false hasta la próxima sincronización.
ALTER TABLE "tenants"
  ADD COLUMN "stripe_price_id" TEXT,
  ADD COLUMN "billing_interval" TEXT,
  ADD COLUMN "current_period_end" TIMESTAMP(3),
  ADD COLUMN "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "subscription_cancel_at" TIMESTAMP(3),
  ADD COLUMN "subscription_ended_at" TIMESTAMP(3),
  ADD COLUMN "subscription_synced_at" TIMESTAMP(3);
