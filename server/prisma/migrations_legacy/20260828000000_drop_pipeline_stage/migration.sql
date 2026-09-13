-- 商机阶段不再落库：删除 SalesPipeline.stage 字段
-- 阶段改为由关联单据推导（server/src/utils/pipelineStage.ts）：
--   关联订单(Order)/报价(Quotation) → QUOTED / SAMPLE / PRODUCTION / SHIPPED / ORDER
--   未关联任何单据 → OPPORTUNITY

ALTER TABLE "SalesPipeline" DROP COLUMN IF EXISTS "stage";
