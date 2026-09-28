-- 新增线索阶段锁定标志：随暂存/建档/提交落库，详情打开时直接复现锁定状态，
-- 避免仅依赖 draft 派生导致关掉后锁定状态丢失
ALTER TABLE "Lead" ADD COLUMN "customerLocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Lead" ADD COLUMN "productLocked" BOOLEAN NOT NULL DEFAULT false;
