-- AlterTable 线索增加来源渠道/平台名称字段（存渠道名或「渠道 / 平台」完整路径）
ALTER TABLE "Lead" ADD COLUMN "sourceChannel" TEXT;
