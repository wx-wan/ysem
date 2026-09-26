-- ============================================================
-- 线索向导阶段：新增 Lead.stage
--
-- 变更：
--   1. ADD Lead.stage（三步向导当前阶段：0 客户信息 / 1 需求详情 / 2 确认商机）。
--      暂存/保存时由前端写入，详情面板据此决定底部按钮展示「编辑」或「确认」。
--      旧数据为 NULL（前端视为已到确认阶段）。
--
-- 配套：
--   - prisma/schema/03-customer.prisma：Lead 增加 stage Int?
--   - controllers/lead.controller.ts：leadSchema 声明 stage、
--     LEAD_WRITABLE_FIELDS 增加 stage、createLead 写入 stage
-- ============================================================

ALTER TABLE "Lead" ADD COLUMN "stage" INTEGER;
