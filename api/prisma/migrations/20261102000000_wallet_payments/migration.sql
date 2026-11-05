-- Pagos con billetera digital P2P (Airtm, Takenos, Wallbit) con verificación manual del administrador.
-- Idempotente (IF NOT EXISTS) para convivir con schemas donde ya se aplicó manualmente.
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'WALLET';

ALTER TABLE "payment_settings"
    ADD COLUMN IF NOT EXISTS "walletEnabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "walletProvider" TEXT,
    ADD COLUMN IF NOT EXISTS "walletAccount" TEXT,
    ADD COLUMN IF NOT EXISTS "walletInstructions" TEXT;

