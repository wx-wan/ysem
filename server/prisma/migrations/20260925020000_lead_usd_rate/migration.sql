-- ============================================================
-- 线索汇率字段调整：删除「目标价位汇率」，新增「建档美元汇率」
--
-- 变更：
--   1. DROP Lead.targetPriceRate（原「目标价位汇率快照：1 单位币种 = X CNY」，
--      改为不再以线索币种汇率快照随金额落库）。
--   2. ADD Lead.usdRate（「建档美元汇率」：1 USD = X CNY），
--      于线索建档时抓取当日 DailyExchangeRate.USD.rateToCny 落库，
--      与线索币种无关，建档后不再变更。
--
-- 配套（同一批次上线，不可拆分）：
--   - prisma/schema/03-customer.prisma：Lead.targetPriceRate → Lead.usdRate
--   - controllers/lead.controller.ts：移除 targetPriceRate（入参 / 可写字段 / 创建写入），
--     新增 createLead 建档时抓取当日 USD 汇率写入 usdRate
-- ============================================================

ALTER TABLE "Lead" DROP COLUMN "targetPriceRate";
ALTER TABLE "Lead" ADD COLUMN "usdRate" DECIMAL(18, 8);
