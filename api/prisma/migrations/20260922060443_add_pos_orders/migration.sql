-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('WEB', 'POS');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('STRIPE', 'CASH', 'PHYSICAL_CARD');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'STRIPE',
ADD COLUMN     "source" "OrderSource" NOT NULL DEFAULT 'WEB',
ADD COLUMN     "cashierId" TEXT;

-- CreateIndex
CREATE INDEX "orders_cashierId_idx" ON "orders"("cashierId");

-- CreateIndex
CREATE INDEX "orders_source_idx" ON "orders"("source");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
