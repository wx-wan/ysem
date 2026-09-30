-- ============================================================
-- V1.1 · lead-fk-only
-- 线索不再冗余持有客户 / 产品主数据：
--   · 客户信息经 Lead.customerId 关联 Customer（CompanyName / 联系人 / 联系方式 / 邮箱 /
--     电话 / 国家 / 客户类型 由客户库唯一持有）
--   · 产品信息经 LeadItem.productId 关联 Product（产品名 / 工艺 / 受众 / 品类 / 长宽高 /
--     克重 由产品库唯一持有）
--   · 线索内数量双写收敛为 LeadItem.quantity
--
-- 【前置条件（必须）】
--   先执行：npx tsx prisma/scripts/backfill-lead-fk.ts --apply
--   该脚本会把「只有文本、尚未关联主数据」的线索信息落库并回填外键、合并规格。
--   未执行回填直接跑本迁移 = 不可逆的数据丢失。
--
-- 【保留】LeadItem.productDesc = 线索级「客户具体要求」，非产品主数据副本，不删除。
-- ============================================================

-- ---------- Lead：客户类 7 列 + 线索级数量 ----------
ALTER TABLE "Lead" DROP COLUMN IF EXISTS "companyName";
ALTER TABLE "Lead" DROP COLUMN IF EXISTS "contactName";
ALTER TABLE "Lead" DROP COLUMN IF EXISTS "contactMethods";
ALTER TABLE "Lead" DROP COLUMN IF EXISTS "email";
ALTER TABLE "Lead" DROP COLUMN IF EXISTS "phone";
ALTER TABLE "Lead" DROP COLUMN IF EXISTS "country";
ALTER TABLE "Lead" DROP COLUMN IF EXISTS "customerType";
ALTER TABLE "Lead" DROP COLUMN IF EXISTS "quantity";

-- ---------- LeadItem：产品类 8 列 ----------
ALTER TABLE "LeadItem" DROP COLUMN IF EXISTS "productName";
ALTER TABLE "LeadItem" DROP COLUMN IF EXISTS "craftIds";
ALTER TABLE "LeadItem" DROP COLUMN IF EXISTS "audienceId";
ALTER TABLE "LeadItem" DROP COLUMN IF EXISTS "categoryId";
ALTER TABLE "LeadItem" DROP COLUMN IF EXISTS "sizeL";
ALTER TABLE "LeadItem" DROP COLUMN IF EXISTS "sizeW";
ALTER TABLE "LeadItem" DROP COLUMN IF EXISTS "sizeH";
ALTER TABLE "LeadItem" DROP COLUMN IF EXISTS "weight";
