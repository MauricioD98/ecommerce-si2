-- Panel de administración sin conexión (PWA): recibos de los cambios aplicados por POST /admin/offline-sync.
-- Solo agrega una tabla: compatible con el código anterior.
CREATE TABLE "offline_sync_receipts" (
    "changeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "offline_sync_receipts_pkey" PRIMARY KEY ("changeId")
);
CREATE INDEX "offline_sync_receipts_userId_idx" ON "offline_sync_receipts"("userId");
