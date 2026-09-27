-- 日志整合（全量）：单一 OperationLog 审计库，移除 CustomerActivity / OpportunityActivity 副表
-- 目标：所有系统操作只落在 OperationLog，各模块按 businessType(+businessId) / customerId 捞取。

-- 1) OperationLog 增加 customerId 列，使客户时间线可按 customerId 捞出跨实体事件
--    （如「创建/更新了关联该客户的线索、商机」），无需 CustomerActivity 副表。
ALTER TABLE "OperationLog" ADD COLUMN "customerId" text;
CREATE INDEX "OperationLog_customerId_idx" ON "OperationLog" ("customerId");

-- 2) 历史 CustomerActivity 行去重补录进 OperationLog
--    因 activityLogger 长期双写，绝大多数已存在；NOT EXISTS 仅补齐早期未双写的记录。
INSERT INTO "OperationLog"
  ("id", "userId", "username", "realName", "action", "module", "businessType", "businessId", "businessNo", "summary", "diff", "ip", "customerId", "createdAt")
SELECT
  gen_random_uuid(), NULL, ca."createdBy", ca."realName", ca."action", 'customer',
  'CUSTOMER', ca."customerId", NULL, ca."summary", ca."diff", NULL, ca."customerId", ca."createdAt"
FROM "CustomerActivity" ca
WHERE NOT EXISTS (
  SELECT 1 FROM "OperationLog" o
  WHERE o."businessType" = 'CUSTOMER'
    AND o."businessId" = ca."customerId"
    AND o."action" = ca."action"
    AND o."createdAt" = ca."createdAt"
    AND coalesce(o."summary", '') = coalesce(ca."summary", '')
);

-- 3) 历史 OpportunityActivity (仅 CREATED) 去重补录进 OperationLog（action 归一为 OPPORTUNITY_CREATED）
INSERT INTO "OperationLog"
  ("id", "userId", "username", "realName", "action", "module", "businessType", "businessId", "businessNo", "summary", "diff", "ip", "customerId", "createdAt")
SELECT
  gen_random_uuid(), NULL, oa."createdBy", NULL, 'OPPORTUNITY_CREATED', 'sales',
  'OPPORTUNITY', oa."opportunityId", NULL, coalesce(oa."comment", '创建了商机'), NULL, NULL, NULL, oa."createdAt"
FROM "OpportunityActivity" oa
WHERE oa."action" = 'CREATED'
  AND NOT EXISTS (
    SELECT 1 FROM "OperationLog" o
    WHERE o."businessType" = 'OPPORTUNITY'
      AND o."businessId" = oa."opportunityId"
      AND o."action" = 'OPPORTUNITY_CREATED'
      AND o."createdAt" = oa."createdAt"
  );

-- 4) 删除副表（外键随表删除，无需手动处理级联）
DROP TABLE "CustomerActivity";
DROP TABLE "OpportunityActivity";
