-- 删除 Customer.draft（V1.2 收尾，破坏性但已确认无引用）
-- 背景：暂存（未建档）线索不再创建客户，客户信息只存线索快照
--       （`Lead.customerSnapshot` + `Lead.draftCustomerName`），只有建档才创建正式客户；
--       故「草稿客户」概念消失，`draft` 列已无任何读写路径。
-- 前置：存量草稿客户已由 prisma/scripts/migrate-draft-customers.ts 迁移/清理（业务库草稿客户 = 0）。
ALTER TABLE "Customer" DROP COLUMN "draft";
