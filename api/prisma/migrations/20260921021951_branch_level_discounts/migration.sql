/*
  Warnings:

  - Se eliminan `discountPercentage` y `discountPrice` de `products` (se copian antes a `product_inventories`).

*/
-- AlterTable
ALTER TABLE "product_inventories" ADD COLUMN     "discountPercentage" INTEGER,
ADD COLUMN     "discountPrice" DECIMAL(10,2);

-- Migración de datos: el descuento global de cada producto pasa a todos sus registros de inventario
UPDATE "product_inventories" pi
SET "discountPrice" = p."discountPrice", "discountPercentage" = p."discountPercentage"
FROM "products" p
WHERE p."id" = pi."productId"
  AND (p."discountPrice" IS NOT NULL OR p."discountPercentage" IS NOT NULL);

-- AlterTable
ALTER TABLE "products" DROP COLUMN "discountPercentage",
DROP COLUMN "discountPrice";
