-- 暂存客户名匹配键（V1.2 追加，非破坏性）
-- 背景：暂存期不再创建 Customer 行（暂存客户不进客户库），客户信息只存 Lead.customerSnapshot；
--       为支持「暂存即阻塞同名」，另存一列归一化（trim + 小写）后的公司名作为占用键。
-- 语义：仅暂存期（customerLocked = false 且 customerId 为空）有值；建档 / 关联既有客户后清空。
ALTER TABLE "Lead" ADD COLUMN "draftCustomerName" TEXT;

CREATE INDEX "Lead_draftCustomerName_idx" ON "Lead"("draftCustomerName");
