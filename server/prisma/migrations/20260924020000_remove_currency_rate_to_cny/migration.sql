-- ============================================================
-- 币种主数据移除写死的汇率列（CurrencyRate.rateToCny）
--
-- 背景：
--   汇率原本是「每日汇率」（DailyExchangeRate，GET /api/ext/exchange）取值，
--   币种主数据只应维护代码 / 名称 / 符号 / 启用 / 排序。
--   前一版把 rateToCny 写入币种主数据（并在 seed 中写死 USD = 7.14），
--   属于把动态汇率固化成静态值，与既有逻辑冲突，故移除该列。
--
-- 配套（同一批次上线，不可拆分）：
--   - prisma/schema/05-master.prisma：CurrencyRate 移除 rateToCny
--   - prisma/seed.ts：币种基线数据不再带 rateToCny
--   - controllers/currency.controller.ts：入参与创建不再处理 rateToCny
--   - 客户端：数据管理币种维护移除汇率列 / 表单项；汇率恢复取每日汇率接口
-- ============================================================

ALTER TABLE "CurrencyRate" DROP COLUMN "rateToCny";
