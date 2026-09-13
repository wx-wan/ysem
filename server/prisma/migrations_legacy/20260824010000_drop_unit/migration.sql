-- 移除 SingleProduct.unit 字段：单品/组合区分改为「是否来自 ComboProduct 表 / 是否有组合明细」
ALTER TABLE "SingleProduct" DROP COLUMN "unit";
