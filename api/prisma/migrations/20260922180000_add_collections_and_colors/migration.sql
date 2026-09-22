-- Colecciones (Otoño-Invierno, Básicos, etc.) y colores de producto, para el filtro avanzado del catálogo.
-- NOTA: esta migración fue escrita a mano (no generada por `prisma migrate dev`, bloqueado en esta
-- sesión). Antes de aplicarla en un ambiente real, correr:
--   npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
-- y confirmar que no hay diferencias contra este archivo.

-- AlterTable: colores disponibles de la prenda (mismo patrón que "sizes", ver schema.prisma)
ALTER TABLE "products" ADD COLUMN "colors" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "collections" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "bannerImageUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "collections_slug_key" ON "collections"("slug");
CREATE INDEX "collections_slug_idx" ON "collections"("slug");
CREATE INDEX "collections_isActive_idx" ON "collections"("isActive");

-- CreateTable: relación implícita m2m Collection <-> Product (orden alfabético de modelos: Collection, Product)
CREATE TABLE "_CollectionToProduct" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_CollectionToProduct_AB_unique" ON "_CollectionToProduct"("A", "B");
CREATE INDEX "_CollectionToProduct_B_index" ON "_CollectionToProduct"("B");

-- AddForeignKey
ALTER TABLE "_CollectionToProduct" ADD CONSTRAINT "_CollectionToProduct_A_fkey" FOREIGN KEY ("A") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_CollectionToProduct" ADD CONSTRAINT "_CollectionToProduct_B_fkey" FOREIGN KEY ("B") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
