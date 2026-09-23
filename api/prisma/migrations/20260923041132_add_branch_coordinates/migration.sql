-- AlterTable
ALTER TABLE "_CollectionToProduct" ADD CONSTRAINT "_CollectionToProduct_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_CollectionToProduct_AB_unique";

-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;
