import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import type { DbClient } from './types';

/**
 * OperationLog 数据访问（Round R-2 · Lead Pilot）
 *
 * OperationLog 是全系统**唯一**时间线落点（禁止新增 XxxActivity 副表）。
 * 本仓储只提供读取；写入统一走既有 `lib/activity-logger.ts`（不重复建设第二套）。
 */
/** 当前 DbClient 上的 `operationLog` 委托（兼容 prisma 单例与事务客户端） */
const model = (db: DbClient) => (db as typeof prisma).operationLog;

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

  // ============================================================
  // Round R-5 · Phase 4 · D4-b 审计查询（就地扩展，遵守 D15）
  // ============================================================

  count(where: Prisma.OperationLogWhereInput, db: DbClient = prisma): Promise<number> {
    return model(db).count({ where });
  },

  /**
   * 按业务对象聚合「指定动作」的记录数（批量，避免 N+1）。
   *
   * 用于派生类判定：如商机「字段是否被编辑过」（存在 OPPORTUNITY_UPDATED 记录即视为跟进中）。
   */
  groupCountByBusinessIds(
    businessIds: string[],
    actions: string[],
    businessType: string,
    db: DbClient = prisma,
  ): Promise<{ businessId: string | null; _count: number }[]> {
    return model(db).groupBy({
      by: ['businessId'],
      where: { businessType, action: { in: actions }, businessId: { in: businessIds } },
      _count: true,
    }) as unknown as Promise<{ businessId: string | null; _count: number }[]>;
  },

  findMany<T extends Prisma.OperationLogFindManyArgs>(
    args: T,
    db: DbClient = prisma,
  ): Promise<Prisma.OperationLogGetPayload<T>[]> {
    return model(db).findMany(args as Prisma.OperationLogFindManyArgs) as unknown as Promise<
      Prisma.OperationLogGetPayload<T>[]
    >;
  },

};
