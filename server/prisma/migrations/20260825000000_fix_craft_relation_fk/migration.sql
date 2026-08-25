-- 修复 ProductCraft <-> SingleProduct 多对多关系表的外键方向
-- 之前迁移 rename 表后只重建了 A 列外键，但方向指向了 SingleProduct，
-- 与 Prisma 默认的字母顺序（A=ProductCraft, B=SingleProduct）相反，
-- 导致新建产品时工艺 connect 写入 A 列被误判为产品 ID，触发外键约束失败。

-- 清空中间表旧数据（原 Product 表已删除，旧关联已失效）
DELETE FROM "_ProductCraftToSingleProduct";

-- 删除错误/旧的外键约束
ALTER TABLE "_ProductCraftToSingleProduct" DROP CONSTRAINT IF EXISTS "_ProductCraftToSingleProduct_A_fkey";
ALTER TABLE "_ProductCraftToSingleProduct" DROP CONSTRAINT IF EXISTS "_ProductToProductCraft_B_fkey";

-- 按 Prisma 默认顺序重建外键：A=ProductCraft.id, B=SingleProduct.id
ALTER TABLE "_ProductCraftToSingleProduct"
  ADD CONSTRAINT "_ProductCraftToSingleProduct_A_fkey"
  FOREIGN KEY ("A") REFERENCES "ProductCraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "_ProductCraftToSingleProduct"
  ADD CONSTRAINT "_ProductCraftToSingleProduct_B_fkey"
  FOREIGN KEY ("B") REFERENCES "SingleProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
