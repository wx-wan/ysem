-- ============================================================
-- 线索状态收敛为 4 态：NEW / CONFIRMED / SAMPLED / WON
--
-- 决策：
--   1) 状态落库，由单据事件自动推进（转商机→已确认，建打样单→已打样，建订单→已成交）
--   2) 打样单 / 销售订单只挂 opportunityId，线索侧经 **商机间接追溯**，不新增冗余外键列
--   3) 人工改状态入口下线（PATCH /leads/:id/status 移除；PUT /leads/:id 不再接受 status）
--   4) 历史数据一次性重建：全部置 NEW，再按现有关联商机 / 打样单 / 订单重算
--
-- 旧枚举：NEW / CONTACTED / QUALIFIED / CONVERTED / INVALID
--   （CONTACTED / CONVERTED 全仓无写入入口，INVALID 已禁写，QUALIFIED 为转商机后的实际值）
--
-- 执行顺序要点：旧枚举不含 CONFIRMED / SAMPLED / WON，
-- 必须「先全部归零为 NEW → 重建枚举类型 → 再按单据重算」，否则写入新值会触发 22P02。
--
-- 配套（同一批次上线，不可拆分）：
--   - prisma/schema/00-enums.prisma：LeadStatus 收敛为 4 值
--   - utils/leadStatus.ts：状态推进工具（单调向前，失败不阻断单据创建）
--   - controllers/lead.controller.ts：移除 status 入参与白名单、删除 changeLeadStatus
--   - routes/lead.routes.ts：移除 PATCH /:id/status
--   - controllers/sales.controller.ts：创建商机后推进 CONFIRMED
--   - controllers/sampleOrder.controller.ts：创建打样单后推进 SAMPLED
--   - controllers/salesOrder.controller.ts：创建销售订单后推进 WON
--   - 客户端：LeadStatus 类型 / STATUS_META / i18n / 只读与「确认」按钮判定
-- ============================================================

-- 1) 历史状态归零：统一置为「新线索」（旧枚举仅含 NEW，故必须先归零）
UPDATE "Lead" SET "status" = 'NEW';

-- 2) 枚举重建：Postgres 不支持 DROP VALUE，故新建类型 → 切列 → 删旧类型 → 改名
CREATE TYPE "LeadStatus_new" AS ENUM ('NEW', 'CONFIRMED', 'SAMPLED', 'WON');

ALTER TABLE "Lead" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Lead" ALTER COLUMN "status" TYPE "LeadStatus_new" USING ("status"::text::"LeadStatus_new");
ALTER TABLE "Lead" ALTER COLUMN "status" SET DEFAULT 'NEW';

DROP TYPE "LeadStatus";
ALTER TYPE "LeadStatus_new" RENAME TO "LeadStatus";

-- 3) 按现有关联单据重算（新枚举此时已含全部 4 个值）
-- 3.1) 已绑定商机 → 已确认
UPDATE "Lead" l
SET "status" = 'CONFIRMED'
WHERE EXISTS (SELECT 1 FROM "Opportunity" o WHERE o."leadId" = l."id");

-- 3.2) 商机下已生成打样单 → 已打样（覆盖「已确认」）
UPDATE "Lead" l
SET "status" = 'SAMPLED'
WHERE EXISTS (
  SELECT 1 FROM "Opportunity" o
  JOIN "SampleOrder" s ON s."opportunityId" = o."id"
  WHERE o."leadId" = l."id"
);

-- 3.3) 商机下已生成销售订单 → 已成交（优先级最高，覆盖「已打样」）
UPDATE "Lead" l
SET "status" = 'WON'
WHERE EXISTS (
  SELECT 1 FROM "Opportunity" o
  JOIN "SalesOrder" so ON so."opportunityId" = o."id"
  WHERE o."leadId" = l."id"
);
