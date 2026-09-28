import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import type { DbClient } from './types';

/**
 * OperationLog 数据访问（Round R-2 · Lead Pilot）
 *
 * OperationLog 是全系统**唯一**时间线落点（禁止新增 XxxActivity 副表）。
 * 本仓储只提供读取；写入统一走既有 `lib/activity-logger.ts`（不重复建设第二套）。
 */
export const operationLogRepository = {
  /** 按业务对象条件取操作记录（线索「操作记录」Tab 数据源） */
  findByBusiness(
    where: Prisma.OperationLogWhereInput,
    take: number,
    db: DbClient = prisma,
  ) {
    return db.operationLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
    });
  },
};
