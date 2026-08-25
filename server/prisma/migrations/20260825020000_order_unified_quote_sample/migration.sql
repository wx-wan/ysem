-- 统一单据表：报价 / 打样 / 正式订单 并入 Order（type 切换）
-- 删除独立 Quote / SampleApply 模型，新增 ApprovalConfig

-- 1) 删除旧 Quote / SampleApply 表（含外键）
ALTER TABLE "Quote" DROP CONSTRAINT IF EXISTS "Quote_ownerId_fkey";
DROP TABLE IF EXISTS "Quote";

ALTER TABLE "SampleApply" DROP CONSTRAINT IF EXISTS "SampleApply_applicantId_fkey";
DROP TABLE IF EXISTS "SampleApply";

-- 2) Order 表扩展为通用单据
ALTER TABLE "Order" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'ORDER';
ALTER TABLE "Order" ADD COLUMN "title" TEXT;
ALTER TABLE "Order" ADD COLUMN "targetType" TEXT;
ALTER TABLE "Order" ADD COLUMN "targetId" TEXT;
ALTER TABLE "Order" ADD COLUMN "pipelineId" TEXT;
ALTER TABLE "Order" ADD COLUMN "stage" TEXT DEFAULT 'DEPOSIT';
ALTER TABLE "Order" ADD COLUMN "items" TEXT;
ALTER TABLE "Order" ADD COLUMN "currency" TEXT DEFAULT 'CNY';
ALTER TABLE "Order" ADD COLUMN "remark" TEXT;

-- 审批态 status 默认从 DEPOSIT 改为 DRAFT
ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
UPDATE "Order" SET "status" = 'DRAFT' WHERE "status" = 'DEPOSIT' OR "status" IS NULL;

-- notes -> remark
UPDATE "Order" SET "remark" = "notes" WHERE "notes" IS NOT NULL AND "remark" IS NULL;
ALTER TABLE "Order" DROP COLUMN IF EXISTS "notes";

CREATE INDEX IF NOT EXISTS "Order_type_idx" ON "Order"("type");
CREATE INDEX IF NOT EXISTS "Order_status_idx" ON "Order"("status");

-- 3) 审批配置表
CREATE TABLE "ApprovalConfig" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "approverIds" TEXT,
    "approverNames" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ApprovalConfig_type_key" ON "ApprovalConfig"("type");
