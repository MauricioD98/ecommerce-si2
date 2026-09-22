-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'QR';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "nit" TEXT,
ADD COLUMN     "razonSocial" TEXT;

