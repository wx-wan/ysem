-- 移除产品规格字段 spec：产品信息不再记录规格，组合明细行内快速新建单品也不再填写规格
ALTER TABLE "SingleProduct" DROP COLUMN "spec";
ALTER TABLE "ComboItem" DROP COLUMN "spec";
