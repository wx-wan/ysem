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


  // ============================================================
  // Round R-5 · Phase 4 · D1-a 采购域：PurchaseOrder 属主 CRUD
  // ============================================================

  findMany<T extends Prisma.PurchaseOrderFindManyArgs>(args: T, db: DbClient = prisma): Promise<Prisma.PurchaseOrderGetPayload<T>[]> {
    return model(db).findMany(args as Prisma.PurchaseOrderFindManyArgs) as unknown as Promise<Prisma.PurchaseOrderGetPayload<T>[]>;
  },

  // findFirst 已在 D3（Payment 宿主 scope 门）建立，此处不重复声明

  count(where: Prisma.PurchaseOrderWhereInput, db: DbClient = prisma): Promise<number> {
    return model(db).count({ where });
  },

  create<T extends Prisma.PurchaseOrderCreateArgs>(args: T, db: DbClient = prisma): Promise<Prisma.PurchaseOrderGetPayload<T>> {
    return model(db).create(args as Prisma.PurchaseOrderCreateArgs) as unknown as Promise<Prisma.PurchaseOrderGetPayload<T>>;
  },

  update<T extends Prisma.PurchaseOrderUpdateArgs>(args: T, db: DbClient = prisma): Promise<Prisma.PurchaseOrderGetPayload<T>> {
    return model(db).update(args as Prisma.PurchaseOrderUpdateArgs) as unknown as Promise<Prisma.PurchaseOrderGetPayload<T>>;
  },

  delete(id: string, db: DbClient = prisma) {
    return model(db).delete({ where: { id } });
  },

  /**
   * 既有明细的行级状态（`arrivedQty` / `status`）与旧引用 id。
   * 更新时按 `lineNo` 保留行级状态，避免明细重建时无意重置；
   * 旧引用 id 用于「旧 ∪ 新」批量加锁。
   */
  findItemStatesByOrderId(purchaseOrderId: string, db: DbClient = prisma) {
    return (db as typeof prisma).purchaseOrderItem.findMany({
      where: { purchaseOrderId },
      select: { id: true, lineNo: true, arrivedQty: true, status: true, productionOrderItemId: true },
    });
  },

};
