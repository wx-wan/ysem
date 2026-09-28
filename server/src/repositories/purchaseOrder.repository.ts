import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { applyScope } from '../utils/scope';
import type { DbClient } from './types';

/**
 * PurchaseOrder 数据访问（Data Layer）
 *
 * 【Round R-5 · Phase 4 · D3 审批域 建最小面】多态审批引用读取（只读）。
 * 【演进约定（R-5.2 · D15）】D1 履约域迁移时就地扩展本仓储，不新建平行仓储。
 */
const model = (db: DbClient) => (db as typeof prisma).purchaseOrder;

export const purchaseOrderRepository = {
  /** 审批引用：主键 + 业务编号 */
  findRefById(id: string, db: DbClient = prisma) {
    return model(db).findUnique({ where: { id }, select: { id: true, purchaseNo: true } });
  },

  findScopedIds(scope: Record<string, unknown>, id?: string, db: DbClient = prisma) {
    return model(db).findMany({
      where: applyScope(id ? { id } : {}, scope) as Prisma.PurchaseOrderWhereInput,
      select: { id: true },
    });
  },
  /** 宿主 scope 校验（Payment OUT 方向的 PurchaseOrder 归属门） */
  findFirst<T extends Prisma.PurchaseOrderFindFirstArgs>(
    args: T,
    db: DbClient = prisma,
  ): Promise<Prisma.PurchaseOrderGetPayload<T> | null> {
    return model(db).findFirst(args as Prisma.PurchaseOrderFindFirstArgs) as unknown as Promise<
      Prisma.PurchaseOrderGetPayload<T> | null
    >;
  },

};
