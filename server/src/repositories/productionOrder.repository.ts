import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { applyScope } from '../utils/scope';
import type { DbClient } from './types';

/**
 * ProductionOrder 数据访问（Data Layer）
 *
 * 【Round R-5 · Phase 4 · D3 审批域 建最小面】
 *   审批流水为**多态旁挂**（`bizType + businessId`，schema 无外键），审批域必须按 bizType
 *   直接读取各业务表的主键与编号。本文件当前只提供这批**只读**能力。
 *
 * 【演进约定（R-5.2 · D15）】D1 履约域迁移时将**就地扩展**本仓储，
 *   不得新建平行仓储（如 `productionOrderRepository2` / `production.repository`）。
 */
const model = (db: DbClient) => (db as typeof prisma).productionOrder;

export const productionOrderRepository = {
  /** 审批引用：主键 + 业务编号 */
  findRefById(id: string, db: DbClient = prisma) {
    return model(db).findUnique({ where: { id }, select: { id: true, productionNo: true } });
  },

  /** 审批 Scope 白名单：当前用户可见的业务对象 id（scope 条件由调用方给出） */
  findScopedIds(scope: Record<string, unknown>, id?: string, db: DbClient = prisma) {
    return model(db).findMany({
      where: applyScope(id ? { id } : {}, scope) as Prisma.ProductionOrderWhereInput,
      select: { id: true },
    });
  },

  // ============================================================
  // Round R-5 · Phase 4 · D1-a 采购域：ProductionOrderItem 读取 + 行锁
  // ============================================================
  // 成本归集链 ADR-14：SalesOrderItem → ProductionOrderItem → PurchaseOrderItem → PurchaseOrder。
  // 采购明细引用 ProductionOrderItem，因此采购域需要该校验读取与并发锁；
  // D1-b 生产域迁移时**就地扩展**本仓储（不新建平行仓储）。

  /** 生产明细读取（存在性校验 + 跨工单绑定校验共用） */
  findItemsByIds(ids: string[], db: DbClient = prisma) {
    return (db as typeof prisma).productionOrderItem.findMany({
      where: { id: { in: ids } },
      select: { id: true, productionOrderId: true },
    });
  },

  /**
   * 锁定受影响的 ProductionOrderItem 行（并发硬化）。
   *
   * 目的：把「成本归集链引用校验（存在性 / 跨工单绑定）→ 明细分重建」纳入同一临界区。
   * 否则并发删除生产明细时，FK `onDelete: SetNull` 会在校验通过后**静默解绑**引用。
   *
   * 为什么 FOR UPDATE 足够：PostgreSQL 插入带 FK 引用的行时对父行请求 FOR KEY SHARE，
   * 与 FOR UPDATE 冲突 ⇒ 并发 INSERT 阻塞至本事务提交；提交后父行若已删除，
   * 对方 FK 校验失败 → P2003 → 应用层显式 4xx。
   *
   * 约束（不得放宽）：只锁 `ProductionOrderItem`；`ORDER BY id ASC` 消除 AB/BA 循环等待；
   * 必须在**调用方事务**内执行；入参先 Set 去重 + 过滤空值，空数组直接返回（不得生成 `IN ()`）。
   */
  async lockItemsForUpdate(ids: Array<string | null | undefined>, db: DbClient = prisma): Promise<void> {
    const unique = Array.from(new Set(ids.filter((v): v is string => Boolean(v)))).sort();
    if (unique.length === 0) return;
    await db.$queryRaw`
      SELECT id
      FROM "ProductionOrderItem"
      WHERE id IN (${Prisma.join(unique)})
      ORDER BY id ASC
      FOR UPDATE
    `;
  },

  /** 归属 scope 校验（采购单引用的生产工单必须落在当前用户数据范围内） */
  findFirst<T extends Prisma.ProductionOrderFindFirstArgs>(
    args: T,
    db: DbClient = prisma,
  ): Promise<Prisma.ProductionOrderGetPayload<T> | null> {
    return model(db).findFirst(args as Prisma.ProductionOrderFindFirstArgs) as unknown as Promise<
      Prisma.ProductionOrderGetPayload<T> | null
    >;
  },

};
