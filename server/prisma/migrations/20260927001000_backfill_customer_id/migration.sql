-- 回填历史 OperationLog.customerId（上一迁移新增该列，既有记录 customerId 为 NULL）。
-- 客户时间线现统一按 customerId 查询，故需把历史记录关联到客户，避免历史数据丢失：
-- 1) CUSTOMER 业务：businessId 即客户 id
UPDATE "OperationLog" SET "customerId" = "businessId"
WHERE "businessType" = 'CUSTOMER' AND "customerId" IS NULL;

-- 2) LEAD 业务：按 Lead.customerId 关联（线索期事件归入其客户时间线）
UPDATE "OperationLog" o SET "customerId" = l."customerId"
FROM "Lead" l
WHERE o."businessType" = 'LEAD' AND o."businessId" = l."id" AND o."customerId" IS NULL;

-- 3) OPPORTUNITY 业务：按 Opportunity.customerId 关联（商机事件归入其客户时间线）
UPDATE "OperationLog" o SET "customerId" = op."customerId"
FROM "Opportunity" op
WHERE o."businessType" = 'OPPORTUNITY' AND o."businessId" = op."id" AND o."customerId" IS NULL;
