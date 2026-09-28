import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import type { DbClient } from './types';

/**
 * LoginLog 数据访问 —— Round R-5 · Phase 4 · D4-b 认证与会话 / 审计域
 *
 * 归属：Data Layer。登录审计为**追加型**记录（只写不读），故仅暴露 `create`。
 */
const model = (db: DbClient) => (db as typeof prisma).loginLog;

export const loginLogRepository = {
  create(data: Prisma.LoginLogUncheckedCreateInput, db: DbClient = prisma) {
    return model(db).create({ data });
  },
};
