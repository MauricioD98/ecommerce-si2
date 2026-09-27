-- AlterTable
-- Sucursal contra la que se reservó (descontó) el stock de este ítem al agregarlo al carrito.
-- Null = se agregó sin sucursal elegida (reserva contra el stock global legado, Product.stock).
ALTER TABLE "cart_items" ADD COLUMN     "branchId" TEXT;

-- CreateIndex
CREATE INDEX "cart_items_branchId_idx" ON "cart_items"("branchId");

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
