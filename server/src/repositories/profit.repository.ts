import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { applyScope } from '../scope';
import type { DbClient } from './types';

/**
 * Profit 数据访问（Data Layer）
 *
 * 【Round R-5 · Phase 4 · D3 审批域 建最小面】多态审批引用读取（只读）。
 * 【演进约定（R-5.2 · D15）】D2 财务域迁移时就地扩展本仓储，不新建平行仓储。
 *
 * 注意：Profit **自身无 ownerId**，数据范围经 `salesOrder` 关系继承
 * （scope 由调用方组装，如 `{ salesOrder: ownerScope }`）。
 */
const model = (db: DbClient) => (db as typeof prisma).profit;

export const profitRepository = {
  /** 审批引用：主键 + 业务编号 */
  findRefById(id: string, db: DbClient = prisma) {
    return model(db).findUnique({ where: { id }, select: { id: true, profitNo: true } });
  },

  findScopedIds(scope: Record<string, unknown>, id?: string, db: DbClient = prisma) {
    return model(db).findMany({
      where: applyScope(id ? { id } : {}, scope) as Prisma.ProfitWhereInput,
      select: { id: true },
    });
  },

  // ============================================================
  // Round R-5 · Phase 4 · D2 财务域：Profit 属主 CRUD
  // ============================================================

  findMany<T extends Prisma.ProfitFindManyArgs>(args: T, db: DbClient = prisma): Promise<Prisma.ProfitGetPayload<T>[]> {
    return model(db).findMany(args as Prisma.ProfitFindManyArgs) as unknown as Promise<Prisma.ProfitGetPayload<T>[]>;
  },

  findFirst<T extends Prisma.ProfitFindFirstArgs>(args: T, db: DbClient = prisma): Promise<Prisma.ProfitGetPayload<T> | null> {
    return model(db).findFirst(args as Prisma.ProfitFindFirstArgs) as unknown as Promise<Prisma.ProfitGetPayload<T> | null>;
  },

  count(where: Prisma.ProfitWhereInput, db: DbClient = prisma): Promise<number> {
    return model(db).count({ where });
  },

  create<T extends Prisma.ProfitCreateArgs>(args: T, db: DbClient = prisma): Promise<Prisma.ProfitGetPayload<T>> {
    return model(db).create(args as Prisma.ProfitCreateArgs) as unknown as Promise<Prisma.ProfitGetPayload<T>>;
  },

  update<T extends Prisma.ProfitUpdateArgs>(args: T, db: DbClient = prisma): Promise<Prisma.ProfitGetPayload<T>> {
    return model(db).update(args as Prisma.ProfitUpdateArgs) as unknown as Promise<Prisma.ProfitGetPayload<T>>;
  },

  /** 1:1 宿主唯一性判定（create 的 409 前置检查） */
  findBySalesOrderId(salesOrderId: string, db: DbClient = prisma) {
    return model(db).findUnique({ where: { salesOrderId }, select: { id: true, profitNo: true } });
  },

};
