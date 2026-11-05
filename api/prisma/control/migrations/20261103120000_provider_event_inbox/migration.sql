-- Inbox durable de webhooks del proveedor de pagos (plano de control)
CREATE TYPE "InboxStatus" AS ENUM ('PENDING', 'PROCESSED', 'UNRESOLVED', 'DEAD');

CREATE TABLE "provider_event_inbox" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "InboxStatus" NOT NULL DEFAULT 'PENDING',
    "tenant_id" UUID,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_until" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "provider_event_inbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "provider_event_inbox_provider_account_id_event_id_key"
    ON "provider_event_inbox"("provider", "account_id", "event_id");
CREATE INDEX "provider_event_inbox_status_next_attempt_at_idx"
    ON "provider_event_inbox"("status", "next_attempt_at");
