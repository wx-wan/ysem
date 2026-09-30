-- 客户草稿态（V1.1 追加，非破坏性）
-- 语义：由线索「暂存 / 未建档」时创建的客户为草稿；线索完成「建档 / 锁定客户信息」后置为 false。
-- 用途：草稿客户允许其来源线索同步修改公司名称与客户信息（未建档前的可编辑窗口）。
ALTER TABLE "Customer" ADD COLUMN "draft" BOOLEAN NOT NULL DEFAULT false;
