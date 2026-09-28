-- 商机来源渠道 / 平台：与 Lead.channelId / Lead.shopId 同义，线索转商机时原样带入，
-- 使商机页「渠道 / 平台」筛选可对齐线索页（server/src/utils/convertLead.ts 写入）。
ALTER TABLE "Opportunity" ADD COLUMN "channelId" TEXT;
ALTER TABLE "Opportunity" ADD COLUMN "shopId" TEXT;

ALTER TABLE "Opportunity"
  ADD CONSTRAINT "Opportunity_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Opportunity"
  ADD CONSTRAINT "Opportunity_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Opportunity_channelId_idx" ON "Opportunity"("channelId");
CREATE INDEX "Opportunity_shopId_idx" ON "Opportunity"("shopId");
