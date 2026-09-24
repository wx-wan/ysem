-- ============================================================
-- Round 3C · 线索需求字段精简
--
-- 目的：
--   1. 移除 4 个平铺的「要求」扩展字段（已合并进「客户具体要求」文本域）：
--        certRequire  认证要求
--        packageReq   包装要求
--        deliveryReq  交期要求
--        specialReq   特殊要求
--   2. 新增「客户期望交期」结构化日期字段 expectedDelivery（DateTime?）。
--
-- 配套（同一批次上线，不可拆分）：
--   - server/prisma/schema/03-customer.prisma：Lead 模型删除 4 列、新增 expectedDelivery
--   - server/src/controllers/lead.controller.ts：
--       leadSchema / LEAD_WRITABLE_FIELDS / create 持久化同步
--   - client：线索表单新增客户期望交期（antd DatePicker），移除 4 个要求字段
--
-- 范围：仅 DROP 4 列 + ADD 1 列。删除列的数据按产品决策不再保留（需求合并）。
--
-- 前置安全：此 4 列为自由文本、非约束/索引/外键引用，DROP 无级联风险。
-- ============================================================

-- Drop 4 个已废弃的「要求」平铺字段
ALTER TABLE "Lead" DROP COLUMN "certRequire";
ALTER TABLE "Lead" DROP COLUMN "packageReq";
ALTER TABLE "Lead" DROP COLUMN "deliveryReq";
ALTER TABLE "Lead" DROP COLUMN "specialReq";

-- Add 客户期望交期（结构化日期，可空）
ALTER TABLE "Lead" ADD COLUMN "expectedDelivery" TIMESTAMP(3);
