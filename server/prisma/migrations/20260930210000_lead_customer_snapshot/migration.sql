-- 线索客户快照（V1.1 追加，非破坏性）
-- 语义：客户信息在建档（customerLocked = true）时写入一次；此后不随客户档案变更同步更新，
--       且不可由接口修改（不在可写白名单 / 请求 schema 中）。
ALTER TABLE "Lead" ADD COLUMN "customerSnapshot" JSONB;
ALTER TABLE "Lead" ADD COLUMN "customerSnapshotAt" TIMESTAMP(3);
