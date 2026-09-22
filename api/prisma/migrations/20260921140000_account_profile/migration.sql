-- AlterTable
ALTER TABLE "users" ADD COLUMN     "phone" TEXT,
ADD COLUMN     "preferredBranchId" TEXT;

-- CreateIndex
CREATE INDEX "users_preferredBranchId_idx" ON "users"("preferredBranchId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_preferredBranchId_fkey" FOREIGN KEY ("preferredBranchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
