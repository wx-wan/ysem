-- 客户表新增获客来源（渠道/平台）与联系方式，照搬线索模型语义
-- F-CRM-CHANNEL：Customer.channelId / shopId 关联 Channel，承接线索转客户时带入的渠道·平台组合
-- contactMethods：与 Lead.contactMethods 一致的 [{tool, account}] 数组

ALTER TABLE "Customer" ADD COLUMN "channelId" TEXT;
ALTER TABLE "Customer" ADD COLUMN "shopId" TEXT;
ALTER TABLE "Customer" ADD COLUMN "contactMethods" JSONB;

-- 渠道/平台关联（删除渠道不连带删客户，SetNull）
ALTER TABLE "Customer"
  ADD CONSTRAINT "Customer_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Customer"
  ADD CONSTRAINT "Customer_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Customer_channelId_idx" ON "Customer"("channelId");
CREATE INDEX "Customer_shopId_idx" ON "Customer"("shopId");
