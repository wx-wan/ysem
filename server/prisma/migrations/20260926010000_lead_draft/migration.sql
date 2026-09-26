-- ============================================================
-- 线索草稿标记：新增 Lead.draft
--
-- 变更：
--   1. ADD Lead.draft（草稿标记：暂存=true，建档/锁定/正式提交=false）。
--      暂存仅落线索表（不写客户/产品表）；建档/提交时由前端写 false。
--      详情接口返回，前端据此区分「草稿（可编辑、显示暂存）」与「已正式建档（锁定）」。
--
-- 配套：
--   - prisma/schema/03-customer.prisma：Lead 增加 draft Boolean @default(false)
--   - controllers/lead.controller.ts：LEAD_WRITABLE_FIELDS 增加 draft、
--     createLead 写入 draft（zod draft 标记由「不落库」改为持久化）
--   - client LeadFormModal：openEdit 锁定派生为 !!customerId && !draft
-- ============================================================

ALTER TABLE "Lead" ADD COLUMN "draft" BOOLEAN NOT NULL DEFAULT FALSE;

-- 旧数据回填：已暂存（stage 已写入）且未关联客户的线索视为草稿；
-- 已关联客户的旧数据保持 false（视为已建档，与既有锁定行为一致）
UPDATE "Lead" SET "draft" = TRUE WHERE "customerId" IS NULL AND "stage" IS NOT NULL;
