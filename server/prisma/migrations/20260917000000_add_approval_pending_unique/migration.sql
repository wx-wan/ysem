-- ============================================================
-- Round 3C-3-B · Approval 并发一致性
--
-- 目的：同一 (bizType, businessId) 同时最多只能存在 1 条
--       status = 'PENDING' 的 ApprovalRecord。
--
-- 为什么必须是 **partial** unique index：
--   全量 UNIQUE("bizType","businessId") 会错误地禁止
--   APPROVED / REJECTED / WITHDRAWN 历史记录与新的 PENDING 并存，
--   从而破坏「驳回 / 撤回后可重新提交审批」的业务能力。
--   加上 WHERE "status" = 'PENDING' 后，约束范围精确等于业务不变量
--   「同一业务单据**同时**最多一条待审批」。
--
-- 配套（同一批次上线，不可拆分）：
--   server/src/controllers/approvalRecord.controller.ts
--     submitApproval catch 增加 P2002 → 409 分支。
--   原因：控制器自带 try/catch 会先行吞掉 Prisma 错误，全局 errorHandler
--         的 P2002 → 409 兜底对 submit 不可达；缺此分支并发冲突将退化为 500。
--
-- 范围：只新增索引 —— 不修改表结构、不增加 CHECK / trigger / function、
--       不修改 enum、不写任何数据、不做 backfill。
--
-- 前置安全：ApprovalRecord 现存 0 行、重复 PENDING 分组 0
--           ⇒ 无需任何数据清理即可建索引。
--
-- 注：Prisma schema 无法表达 partial index，故本约束以 migration 原生 DDL 为权威，
--     schema 侧保持 `@@index([bizType, businessId])` 不变（不新增 @@unique）。
-- ============================================================

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRecord_bizType_businessId_pending_key"
  ON "ApprovalRecord" ("bizType", "businessId")
  WHERE "status" = 'PENDING';
