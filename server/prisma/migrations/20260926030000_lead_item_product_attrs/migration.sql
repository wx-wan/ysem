/*
  Warnings:
  - Added the required column `craftIds` to the `LeadItem` table with a default value.
*/

-- 需求详情扩展：产品分类与规格，与产品主数据字段对齐，建档时带入产品
ALTER TABLE "LeadItem" ADD COLUMN "craftIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "LeadItem" ADD COLUMN "audienceId" TEXT;
ALTER TABLE "LeadItem" ADD COLUMN "categoryId" TEXT;
ALTER TABLE "LeadItem" ADD COLUMN "sizeL" DOUBLE PRECISION;
ALTER TABLE "LeadItem" ADD COLUMN "sizeW" DOUBLE PRECISION;
ALTER TABLE "LeadItem" ADD COLUMN "sizeH" DOUBLE PRECISION;
ALTER TABLE "LeadItem" ADD COLUMN "weight" DOUBLE PRECISION;
