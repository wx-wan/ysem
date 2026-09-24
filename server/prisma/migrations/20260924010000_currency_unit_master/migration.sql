-- ============================================================
-- Round 3C · 币种 / 单位 主数据 + 线索需求字段（currency / unit）
--
-- 目的：
--   1. 新增 CurrencyRate 主数据表（code/name/symbol/rateToCny/isActive/sort），
--      由系统设置维护，作为顶部币种切换 + 汇率换算的数据源（替代原硬编码 + 外部汇率接口）。
--      （表名 CurrencyRate 以避让已存在的 Currency 枚举类型）
--   2. 新增 Unit 主数据表（name/isActive/sort），由系统设置维护，
--      作为线索数量需求后缀的取值（默认 个 / 套）。
--   3. Lead 新增 currency（币种 code）/ unit（单位 name）两列，承载需求详情字段。
--
-- 配套（同一批次上线，不可拆分）：
--   - prisma/schema/05-master.prisma：新增 CurrencyRate / Unit 模型
--   - prisma/schema/03-customer.prisma：Lead 新增 currency / unit
--   - controllers/lead.controller.ts：leadSchema / LEAD_WRITABLE_FIELDS / create 同步
--   - 客户端：币种/单位维护页、线索表单需求字段、顶部币种切换
--
-- 种子数据：CNY(¥,1) / USD($,~7.14)；个 / 套（见 server/prisma/seed.ts）
-- ============================================================

CREATE TABLE "CurrencyRate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "rateToCny" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CurrencyRate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CurrencyRate_code_key" ON "CurrencyRate"("code");
CREATE UNIQUE INDEX "Unit_name_key" ON "Unit"("name");
CREATE INDEX "CurrencyRate_sort_idx" ON "CurrencyRate"("sort");
CREATE INDEX "CurrencyRate_isActive_idx" ON "CurrencyRate"("isActive");
CREATE INDEX "Unit_sort_idx" ON "Unit"("sort");
CREATE INDEX "Unit_isActive_idx" ON "Unit"("isActive");

ALTER TABLE "Lead" ADD COLUMN "currency" TEXT;
ALTER TABLE "Lead" ADD COLUMN "unit" TEXT;
