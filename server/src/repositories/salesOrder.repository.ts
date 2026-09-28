import { Prisma, type SalesOrderStatus } from '@prisma/client';
import prisma from '../lib/prisma';
import { applyScope } from '../utils/scope';
import type { DbClient } from './types';

/**
 * SalesOrder 数据访问（Data Layer）
 *
 * 两种角色：
 *   ① **SalesOrder 业务域的权威访问**（Round R-5 · Phase 1 Sales Process Domain 扩充）；
 *   ② **Customer 领域只读读模型**（Round R-3 建立，方法语义与签名保持不变）。
 *
 * 追加职责（Round R-5 Phase 1 · B5）：为「Customer 订单统计」提供**回算口径的只读聚合**。
 * 仓储只负责聚合，不判定「什么算有效订单」—— 该口径由 Operation 层显式传入 `status` 过滤条件。
 */

const salesOrderModel = (db: DbClient) => (db as typeof prisma).salesOrder;

export const salesOrderRepository = {
  // ============================================================
  // ① Customer 读模型（R-3 建立，语义不变）
  // ============================================================

  /** 按 customer where 汇总本币金额（客户列表「成交总额」口径） */
  sumAmountCnyByCustomerWhere(customerWhere: Prisma.CustomerWhereInput, db: DbClient = prisma) {
    return db.salesOrder.aggregate({
      where: { customer: customerWhere },
      _sum: { totalAmountCny: true },
    });
  },

  /** 按客户 id 批量汇总金额 + 最近下单日（列表 enrichment，避免 N+1） */
  groupAmountByCustomerIds(customerIds: string[], db: DbClient = prisma) {
    return db.salesOrder.groupBy({
      by: ['customerId'],
      _sum: { totalAmountCny: true },
      _max: { orderDate: true },
      where: { customerId: { in: customerIds } },
    });
  },

  /** 按 customer where 取金额列表（报表口径：仅非空金额行） */
  findAmountsByCustomerWhere(customerWhere: Prisma.CustomerWhereInput, db: DbClient = prisma) {
    return db.salesOrder.findMany({
      where: { customer: customerWhere, totalAmountCny: { not: null } },
      select: { totalAmountCny: true },
    });
  },

  /** 按状态计数（报表：已出货订单数） */
  countByStatus(status: SalesOrderStatus, db: DbClient = prisma) {
    return db.salesOrder.count({ where: { status } });
  },

  // ============================================================
  // ② SalesOrder 属主访问（Round R-5 · Phase 1）
  // ============================================================

  findMany<T extends Prisma.SalesOrderFindManyArgs>(
    args: T,
    db: DbClient = prisma,
  ): Promise<Prisma.SalesOrderGetPayload<T>[]> {
    return salesOrderModel(db).findMany(args as Prisma.SalesOrderFindManyArgs) as unknown as Promise<
      Prisma.SalesOrderGetPayload<T>[]
    >;
  },

  findFirst<T extends Prisma.SalesOrderFindFirstArgs>(
    args: T,
    db: DbClient = prisma,
  ): Promise<Prisma.SalesOrderGetPayload<T> | null> {
    return salesOrderModel(db).findFirst(args as Prisma.SalesOrderFindFirstArgs) as unknown as Promise<
      Prisma.SalesOrderGetPayload<T> | null
    >;
  },

  countWhere(where?: Prisma.SalesOrderWhereInput, db: DbClient = prisma): Promise<number> {
    return salesOrderModel(db).count(where ? { where } : undefined);
  },

  create<T extends Prisma.SalesOrderCreateArgs>(
    args: T,
    db: DbClient = prisma,
  ): Promise<Prisma.SalesOrderGetPayload<T>> {
    return salesOrderModel(db).create(args as Prisma.SalesOrderCreateArgs) as unknown as Promise<
      Prisma.SalesOrderGetPayload<T>
    >;
  },

  update<T extends Prisma.SalesOrderUpdateArgs>(
    args: T,
    db: DbClient = prisma,
  ): Promise<Prisma.SalesOrderGetPayload<T>> {
    return salesOrderModel(db).update(args as Prisma.SalesOrderUpdateArgs) as unknown as Promise<
      Prisma.SalesOrderGetPayload<T>
    >;
  },

  delete<T extends Prisma.SalesOrderDeleteArgs>(
    args: T,
    db: DbClient = prisma,
  ): Promise<Prisma.SalesOrderGetPayload<T>> {
    return salesOrderModel(db).delete(args as Prisma.SalesOrderDeleteArgs) as unknown as Promise<
      Prisma.SalesOrderGetPayload<T>
    >;
  },

  /** 明细整表重建用：清空某订单全部 SalesOrderItem */
  deleteItemsByOrderId(orderId: string, db: DbClient = prisma) {
    return db.salesOrderItem.deleteMany({ where: { orderId } });
  },

  /**
   * （Round R-5 · Phase 4 · D3 审批域）多态审批引用读取：主键 + 业务编号。
   * 审批流水以 `bizType + businessId` 旁挂（无外键），需按 bizType 分派到各域仓储取数。
   */
  findRefById(id: string, db: DbClient = prisma) {
    return salesOrderModel(db).findUnique({ where: { id }, select: { id: true, orderNo: true } });
  },

  /** 审批 Scope 白名单：当前用户可见的业务对象 id（scope 条件由调用方给出） */
  findScopedIds(scope: Record<string, unknown>, id?: string, db: DbClient = prisma) {
    return salesOrderModel(db).findMany({
      where: applyScope(id ? { id } : {}, scope) as Prisma.SalesOrderWhereInput,
      select: { id: true },
    });
  },

  /**
   * （Round R-5 · Phase 3）按商机 id 集合取阶段信号 —— 是否存在销售订单、
   * 以及该订单是否已有生产工单 / 出运单。
   * 只取数据；「有生产/出运算什么阶段」由 State 能力（state/pipelineStage.state）判定。
   */
  findStageSignalsByOpportunityIds(ids: string[], db: DbClient = prisma) {
    return salesOrderModel(db).findMany({
      where: { opportunityId: { in: ids } },
      select: {
        opportunityId: true,
        productionOrders: { select: { id: true }, take: 1 },
        shipments: { select: { id: true }, take: 1 },
      },
    });
  },

  /** 明细快照的产品批量读取（授权条件由调用方给出；不可见与不存在同结果） */
  findVisibleProducts(
    productIds: string[],
    visibilityWhere: Prisma.ProductWhereInput = {},
    db: DbClient = prisma,
  ) {
    return db.product.findMany({
      where: { id: { in: productIds }, ...visibilityWhere },
      select: { id: true, name: true, sku: true, packaging: true, material: true, colors: true },
    });
  },

  /**
   * B5 回算：某客户**有效订单**的三项统计原始值。
   *
   * `effectiveWhere` 由 Operation 层显式给出（「什么算有效订单」是业务口径，不在 Data 层判定）。
   * 返回 null 表示该客户无任何有效订单 ⇒ 三项统计应回置 null / 0。
   */
  async aggregateCustomerOrderStats(
    customerId: string,
    effectiveWhere: Prisma.SalesOrderWhereInput,
    db: DbClient = prisma,
  ): Promise<{
    firstOrderAt: Date | null;
    lastOrderAt: Date | null;
    totalOrderAmountCny: Prisma.Decimal;
  }> {
    const [agg, first, last] = await Promise.all([
      salesOrderModel(db).aggregate({
        where: { customerId, ...effectiveWhere },
        _sum: { totalAmountCny: true },
      }),
      salesOrderModel(db).findFirst({
        where: { customerId, ...effectiveWhere },
        orderBy: [{ orderDate: 'asc' }, { createdAt: 'asc' }],
        select: { orderDate: true, createdAt: true },
      }),
      salesOrderModel(db).findFirst({
        where: { customerId, ...effectiveWhere },
        orderBy: [{ orderDate: 'desc' }, { createdAt: 'desc' }],
        select: { orderDate: true, createdAt: true },
      }),
    ]);

    return {
      firstOrderAt: first ? (first.orderDate ?? first.createdAt) : null,
      lastOrderAt: last ? (last.orderDate ?? last.createdAt) : null,
      totalOrderAmountCny: agg._sum.totalAmountCny ?? new Prisma.Decimal(0),
    };
  },
};
