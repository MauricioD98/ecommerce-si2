-- Gestión de pagos de la tienda: QR bancario y USDT con verificación manual.
-- Solo agrega (enums, tablas): no toca datos existentes.
ALTER TYPE "PaymentMethod" ADD VALUE 'BANK_QR';
ALTER TYPE "PaymentMethod" ADD VALUE 'USDT';

CREATE TYPE "UsdtNetwork" AS ENUM ('TRC20', 'ERC20', 'BEP20', 'POLYGON');
CREATE TYPE "PaymentProofStatus" AS ENUM ('PENDIENTE', 'APROBADO', 'RECHAZADO');

CREATE TABLE "payment_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "qrEnabled" BOOLEAN NOT NULL DEFAULT false,
    "qrImage" BYTEA,
    "qrImageType" TEXT,
    "qrInstructions" TEXT,
    "usdtEnabled" BOOLEAN NOT NULL DEFAULT false,
    "usdtNetwork" "UsdtNetwork",
    "usdtWalletAddress" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_proofs" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "image" BYTEA,
    "imageType" TEXT,
    "txId" TEXT,
    "status" "PaymentProofStatus" NOT NULL DEFAULT 'PENDIENTE',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_proofs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_proofs_orderId_key" ON "payment_proofs"("orderId");
CREATE INDEX "payment_proofs_status_idx" ON "payment_proofs"("status");

ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
