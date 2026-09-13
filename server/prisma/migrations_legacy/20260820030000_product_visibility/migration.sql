/*
  Warnings:
  - You are about to drop the column `status` on the `Product` table.
    The data in that column is lost if it exists. Products use visibility (PUBLIC/PRIVATE) instead.
*/

-- AlterTable: 用可见性替换启用/停用状态
ALTER TABLE "Product" DROP COLUMN "status";
ALTER TABLE "Product" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'PUBLIC';

-- CreateTable: 产品可见人关联（visibility=PRIVATE 时生效）
CREATE TABLE "ProductVisibleUser" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductVisibleUser_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ProductVisibleUser" ADD CONSTRAINT "ProductVisibleUser_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductVisibleUser" ADD CONSTRAINT "ProductVisibleUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "ProductVisibleUser_productId_userId_key" ON "ProductVisibleUser"("productId", "userId");
CREATE INDEX "ProductVisibleUser_userId_idx" ON "ProductVisibleUser"("userId");
