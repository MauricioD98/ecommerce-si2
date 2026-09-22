-- El stock pasa de ser por (producto, sucursal) a ser por (producto, sucursal, talla).
-- product_inventories hoy solo tiene datos de seed/demo (re-sembrables con `npm run seed`, que ya
-- quedó actualizado para repartir el stock por talla también). En vez de repartir con SQL frágil el
-- stock viejo entre las tallas de cada producto, se vacía la tabla y se recarga con el seed.

TRUNCATE TABLE "product_inventories";

ALTER TABLE "product_inventories" ADD COLUMN "size" TEXT NOT NULL;

DROP INDEX IF EXISTS "product_inventories_productId_branchId_key";
CREATE UNIQUE INDEX "product_inventories_productId_branchId_size_key" ON "product_inventories"("productId", "branchId", "size");
CREATE INDEX "product_inventories_productId_idx" ON "product_inventories"("productId");
