-- 将 User.refreshToken 单值字段改为 refreshTokens 多值数组（支持多端/多标签页同时在线）
-- 先把已有单值迁移进数组，避免已登录用户被立刻踢下线，再删除旧列
ALTER TABLE "User" ADD COLUMN "refreshTokens" TEXT[] NOT NULL DEFAULT '{}';

UPDATE "User" SET "refreshTokens" = ARRAY["refreshToken"] WHERE "refreshToken" IS NOT NULL;

ALTER TABLE "User" DROP COLUMN "refreshToken";
