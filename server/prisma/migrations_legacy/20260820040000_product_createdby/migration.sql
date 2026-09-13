-- AlterTable: 记录产品创建人，用于「不公开」产品的可见性判定
-- 不公开产品仅 创建人 + 指定可见人 可查看；其余人不可见
ALTER TABLE "Product" ADD COLUMN "createdBy" TEXT;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
