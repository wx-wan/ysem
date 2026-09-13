-- AlterTable 线索增加采购产品与数量
ALTER TABLE "Lead" ADD COLUMN "productId" TEXT,
ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "Lead_productId_idx" ON "Lead"("productId");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SingleProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
