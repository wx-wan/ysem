-- ============================================================
-- 线索目标价位：金额必带汇率快照（Lead.targetPriceRate）
--
-- 背景：
--   所有「钱」字段统一为「币种 + 金额 + 汇率快照」三件套（前端公共组件 MoneyInput）。
--   汇率在录入时快照落库（1 单位该币种 = X CNY，CNY 恒为 1），
--   后续展示与币种切换都用该快照计算，避免历史金额随实时汇率波动。
--   本迁移先落线索的目标价位（后续其它金额字段同样处理）。
--
-- 配套（同一批次上线，不可拆分）：
--   - prisma/schema/03-customer.prisma：Lead 新增 targetPriceRate
--   - controllers/lead.controller.ts：leadSchema 入参 + LEAD_WRITABLE_FIELDS + create 写入
--   - 客户端：components/common/MoneyInput.tsx（金额组件）+ 线索目标价位替换为该组件
-- ============================================================

ALTER TABLE "Lead" ADD COLUMN "targetPriceRate" DECIMAL(18, 8);
