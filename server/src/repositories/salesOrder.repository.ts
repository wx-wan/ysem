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

  /**
   * （Round R-5 · Phase 4 · D2 财务域）行级锁 —— `SELECT ... FOR UPDATE`。
   *
   * 【为什么必须加锁】`paidAmountCny` 的维护是「聚合读 → 整值覆写」两条语句，
   * 写回的是先前算好的常量；无锁时后提交方会以更早快照的求和值覆盖正确值（经典 lost update）。
   *
   * 约束（不得放宽）：
   *   · 只锁 `SalesOrder`（`paidAmountCny` 的唯一宿主）；
   *   · 必须 `ORDER BY id ASC` —— owner 迁移（SO-A ↔ SO-B）同时涉及两行，
   *     确定性顺序消除 AB/BA 循环等待；
   *   · 必须在**调用方的事务内**执行（锁随该事务提交/回滚释放）；
   *   · 入参先 Set 去重 + 过滤空值；空数组直接返回（不得生成 `IN ()`）。
   *
   * 原始 SQL 属 Data 层职责（Operation / Business 不直接持有 SQL）。
   */
  async lockRowsForUpdate(ids: Array<string | null | undefined>, db: DbClient = prisma): Promise<void> {
    const unique = Array.from(new Set(ids.filter((v): v is string => Boolean(v)))).sort();
    if (unique.length === 0) return;
    await db.$queryRaw`
      SELECT id
      FROM "SalesOrder"
      WHERE id IN (${Prisma.join(unique)})
      ORDER BY id ASC
      FOR UPDATE
    `;
  },


  // ============================================================
  // Round R-5 · Phase 4 · D1-b：销售订单明细读取（生产明细快照来源）
  // ============================================================

  /** 生产明细快照来源：`SalesOrderItem`（productName / spec / quantity / unit） */
  findItemsByIds(ids: string[], db: DbClient = prisma) {
    if (ids.length === 0) return Promise.resolve([]);
    return (db as typeof prisma).salesOrderItem.findMany({
      where: { id: { in: ids } },
      select: { id: true, orderId: true, productName: true, spec: true, quantity: true, unit: true },
    });
  },


  // ============================================================
  // Round R-5 · Phase 4 · D1-c 出运域：shippedQty 派生汇总支撑
  // ============================================================

  /** 订单行数量（可出货上限判定依据；此为核心 5 字段的轻量投影） */
  findItemQuantitiesByIds(ids: string[], db: DbClient = prisma) {
    if (ids.length === 0) return Promise.resolve([]);
    return (db as typeof prisma).salesOrderItem.findMany({
      where: { id: { in: ids } },
      select: { id: true, quantity: true },
    });
  },

  /**
   * 按订单行汇总有效出货量（`ShipmentItem.quantity` 之和）。
   *
   * V1.0（D-E4-C = SEMANTIC-A）：**CANCELLED 出运单的明细不计入**有效出货量。
   * `excludeShipmentId` 用于 C-3 门禁「排除本单后取其他单合计」，
   * 在「已删旧明细 / 尚未重建新明细」的任意中间态下均得到同一结论。
   */
  groupShippedQtyByItemIds(
    ids: string[],
    opts: { excludeShipmentId?: string } = {},
    db: DbClient = prisma,
  ) {
    if (ids.length === 0) {
      return Promise.resolve([] as Array<{ salesOrderItemId: string; _sum: { quantity: Prisma.Decimal | null } }>);
    }
    return (db as typeof prisma).shipmentItem.groupBy({
      by: ['salesOrderItemId'],
      where: {
        salesOrderItemId: { in: ids },
        ...(opts.excludeShipmentId ? { shipmentId: { not: opts.excludeShipmentId } } : {}),
        shipment: { status: { not: 'CANCELLED' } },
      },
      _sum: { quantity: true },
    });
  },

  /** 派生缓存写回：`SalesOrderItem.shippedQty = SUM(有效 ShipmentItem.quantity)`（**重算**，非累加） */
  updateItemShippedQty(id: string, shippedQty: Prisma.Decimal, db: DbClient = prisma) {
    return (db as typeof prisma).salesOrderItem.update({ where: { id }, data: { shippedQty } });
  },

  /**
   * 锁定受影响的 `SalesOrderItem` 行（并发硬化）。
   *
   * 目的：把「读聚合 → 判定 / 写回」纳入同一临界区，消除两类并发缺陷：
   *   1) over-shipment：两个并发请求各自读到 already = 0 → 双双通过上限校验；
   *   2) shippedQty 缓存陈旧：`groupBy 读 → UPDATE 写回` 是两条语句，后提交方可能以更早快照
   *      的求和值整值覆写（经典 lost update）。
   *
   * 约束（不得放宽）：只锁 `SalesOrderItem`（它同时是「判定依据 quantity」与「派生缓存
   * shippedQty」的宿主）；`ORDER BY id ASC` 消除 AB/BA 循环等待；必须在**调用方事务**内执行；
   * 入参先 Set 去重 + 过滤空值，空数组直接返回（不得生成 `IN ()`）。
   */
  async lockItemsForUpdate(ids: Array<string | null | undefined>, db: DbClient = prisma): Promise<void> {
    const unique = Array.from(new Set(ids.filter((v): v is string => Boolean(v)))).sort();
    if (unique.length === 0) return;
    await db.$queryRaw`
      SELECT id
      FROM "SalesOrderItem"
      WHERE id IN (${Prisma.join(unique)})
      ORDER BY id ASC
      FOR UPDATE
    `;
  },

};
