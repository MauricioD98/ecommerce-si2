-- Una prenda puede tener varias tallas: "size" (una sola) pasa a "sizes" (lista).
-- Se conserva la talla actual de cada producto copiándola a la nueva lista antes de borrar la columna.

-- AlterTable
ALTER TABLE "products" ADD COLUMN "sizes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Migración de datos existentes
UPDATE "products" SET "sizes" = ARRAY["size"];

-- AlterTable
ALTER TABLE "products" DROP COLUMN "size";
