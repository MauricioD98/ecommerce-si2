-- CreateEnum
CREATE TYPE "FulfillmentType" AS ENUM ('DELIVERY', 'PICKUP');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Role" ADD VALUE 'SUPERADMIN';
ALTER TYPE "Role" ADD VALUE 'ADMIN_SUCURSAL';
ALTER TYPE "Role" ADD VALUE 'EMPLEADO';
ALTER TYPE "Role" ADD VALUE 'CLIENTE';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "discountApplied" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "fulfillmentType" "FulfillmentType" NOT NULL DEFAULT 'DELIVERY';

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "discountPercentage" INTEGER,
ADD COLUMN     "discountPrice" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "employeeDiscount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_inventories" (
    "id" TEXT NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "productId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_inventories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "branches_isActive_idx" ON "branches"("isActive");

-- CreateIndex
CREATE INDEX "product_inventories_branchId_idx" ON "product_inventories"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "product_inventories_productId_branchId_key" ON "product_inventories"("productId", "branchId");

-- CreateIndex
CREATE INDEX "orders_branchId_idx" ON "orders"("branchId");

-- CreateIndex
CREATE INDEX "users_branchId_idx" ON "users"("branchId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_inventories" ADD CONSTRAINT "product_inventories_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_inventories" ADD CONSTRAINT "product_inventories_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
