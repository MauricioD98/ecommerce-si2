-- AlterTable
ALTER TABLE "products" ADD COLUMN     "branchId" TEXT;

-- CreateIndex
CREATE INDEX "products_branchId_idx" ON "products"("branchId");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

