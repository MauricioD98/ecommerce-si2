-- Perfil editable sin conexión (PWA): recibos de los cambios ya aplicados por PATCH /users/me/sync.
-- Solo agrega una tabla: compatible con el código anterior.
CREATE TABLE "profile_sync_receipts" (
    "changeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "profile_sync_receipts_pkey" PRIMARY KEY ("changeId")
);
CREATE INDEX "profile_sync_receipts_userId_idx" ON "profile_sync_receipts"("userId");
