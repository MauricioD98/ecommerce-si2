-- DropIndex
DROP INDEX "cart_items_cartId_productId_key";

-- AlterTable
ALTER TABLE "cart_items" ADD COLUMN     "size" TEXT;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "size" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cartId_productId_size_key" ON "cart_items"("cartId", "productId", "size");
