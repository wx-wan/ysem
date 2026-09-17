import { Response } from 'express';
import { z } from 'zod';
import { Prisma, ProductionItemStatus, ProductionStatus } from '@prisma/client';
import prisma from '../lib/prisma';
import { getNextNumber } from '../lib/numberSequence';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';
import { applyScope, roleScope } from '../utils/scope';
import { activityLogger } from '../lib/activity-logger';
import { BUSINESS_TYPE } from '../lib/business-type';
import { DECIMAL_PRECISION, round } from '../utils/currency';

// ============================================================
// 生产领域（V1.0）
//
// 履约链：SalesOrder → ProductionOrder → ProductionOrderItem
//  - ProductionOrder 是唯一的正式生产执行单实体，**不得**回退到 Order(type=PRODUCTION)；
//  - 明细一律落 ProductionOrderItem（结构化），**不得**使用 JSON items / 旧 OrderItem；
//  - 生产状态使用 ProductionStatus，**不得**复用 SalesOrderStatus / 旧 Order.status / 旧 stage；
//  - ProductionOrder **无 customerId / 无金额三件套**（客户经 salesOrder 派生，成本走 PurchaseOrder → Profit）。
//
// 已 Deferred（不在本轮）：
//  - productionNo 走 NumberSequence runtime（当前沿用「按日最大序号 +1」做法）
//  - 审批流转（全局 approval.controller 仍为 legacy，属独立 slice）
//  - Shipment / QualityInspection / Payment / Profit 业务逻辑（仅详情只读 include）
//  - 出货数量（SalesOrderItem.shippedQty 由 ShipmentItem 汇总回写，属 Shipment round）
//  - 生产成本归集（PurchaseOrderItem.productionOrderItemId → PurchaseOrder → Profit）
// ============================================================

/** 列表统一 include：销售订单（客户经此派生）、明细（含供应商） */
const PRODUCTION_ORDER_INCLUDE: Prisma.ProductionOrderInclude = {
  salesOrder: { select: { id: true, orderNo: true, status: true, customerId: true } },
  items: {
    orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
    include: { supplier: { select: { id: true, name: true } } },
  },
};

/** 详情额外只读 include 下游单据（本轮不实现其业务逻辑） */
const PRODUCTION_ORDER_DETAIL_INCLUDE: Prisma.ProductionOrderInclude = {
  ...PRODUCTION_ORDER_INCLUDE,
  salesOrder: {
    select: {
      id: true,
      orderNo: true,
      status: true,
      customerId: true,
      currency: true,
      totalAmount: true,
      customer: { select: { id: true, customerNo: true, companyName: true } },
    },
  },
  owner: { select: { id: true, username: true, realName: true } },
  inspections: { select: { id: true, inspectionNo: true, type: true, result: true } },
  purchaseOrders: { select: { id: true, purchaseNo: true, status: true } },
};

/** 数量入参：JSON number 或 string，一律经 Decimal 归一，禁止 JS number 参与数量运算 */
const amountSchema = z.union([z.number(), z.string()]);

const itemSchema = z.object({
  salesOrderItemId: z.string().optional().nullable(),
  productName: z.string().optional(),
  spec: z.string().optional().nullable(),
  quantity: amountSchema.optional(),
  completedQty: amountSchema.optional(),
  defectQty: amountSchema.optional(),
  unit: z.string().optional(),
  supplierId: z.string().optional().nullable(),
  plannedStartAt: z.string().optional().nullable(),
  plannedEndAt: z.string().optional().nullable(),
  status: z.nativeEnum(ProductionItemStatus).optional(),
  sort: z.number().int().optional(),
  remark: z.string().optional().nullable(),
});

export type ProductionOrderItemInput = z.infer<typeof itemSchema>;

const createSchema = z.object({
  salesOrderId: z.string().min(1, '销售订单不能为空'),
  status: z.nativeEnum(ProductionStatus).optional(),
  plannedStartAt: z.string().optional().nullable(),
  plannedEndAt: z.string().optional().nullable(),
  actualStartAt: z.string().optional().nullable(),
  actualEndAt: z.string().optional().nullable(),
  ownerId: z.string().optional().nullable(),
  workshop: z.string().optional().nullable(),
  requirement: z.string().optional().nullable(),
  progress: z.number().int().min(0).max(100).optional(),
  remark: z.string().optional().nullable(),
  items: z.array(itemSchema).optional(),
});

const updateSchema = createSchema.partial().extend({
  id: z.string().min(1),
  // 所属销售订单为不可变上游关系；显式传入仅用于给出 400 提示
  salesOrderId: z.string().optional(),
});

const listQuerySchema = z.object({
  salesOrderId: z.string().optional(),
  customerId: z.string().optional(),
  status: z.nativeEnum(ProductionStatus).optional(),
  ownerId: z.string().optional(),
  keyword: z.string().optional(),
  page: z.union([z.string(), z.number()]).optional(),
  pageSize: z.union([z.string(), z.number()]).optional(),
});

interface ParsedItemsOk {
  ok: true;
  data: Prisma.ProductionOrderItemUncheckedCreateWithoutProductionOrderInput[];
  /** 由明细汇总的生产进度（0-100）；无明细时为 null（不覆盖显式入参 / 不写入 0 以外的推断） */
  progress: number | null;
}
interface ParsedItemsFail {
  ok: false;
  status: 400 | 404;
  message: string;
}

/**
 * 生产明细解析 + 快照（ADR-04）。
 *
 * 快照权威：显式传入 > SalesOrderItem 快照。
 * SalesOrderItem.productName 为 NOT NULL，故第三级「Product / CustomerProduct 当前值」在 schema 上不可达；
 * 且 ProductionOrderItem 无 productId / customerProductId 列，产品血缘经 salesOrderItemId 传递（Schema limitation）。
 */
async function parseItems(
  raw: ProductionOrderItemInput[] | undefined,
  salesOrderId: string,
): Promise<ParsedItemsOk | ParsedItemsFail> {
  if (!raw || raw.length === 0) return { ok: true, data: [], progress: null };

  const soItemIds = Array.from(
    new Set(raw.map((i) => i.salesOrderItemId).filter((v): v is string => Boolean(v))),
  );
  const soItems = soItemIds.length
    ? await prisma.salesOrderItem.findMany({
        where: { id: { in: soItemIds } },
        select: { id: true, orderId: true, productName: true, spec: true, quantity: true, unit: true },
      })
    : [];
  const soItemById = new Map(soItems.map((i) => [i.id, i]));

  // 供应商存在性校验（一次批量查询）
  const supplierIds = Array.from(
    new Set(raw.map((i) => i.supplierId).filter((v): v is string => Boolean(v))),
  );
  if (supplierIds.length > 0) {
    const found = await prisma.supplier.count({ where: { id: { in: supplierIds } } });
    if (found !== supplierIds.length) {
      return { ok: false, status: 400, message: '供应商不存在' };
    }
  }

  const data: Prisma.ProductionOrderItemUncheckedCreateWithoutProductionOrderInput[] = [];
  let totalQty = new Prisma.Decimal(0);
  let doneQty = new Prisma.Decimal(0);

  for (const [index, item] of raw.entries()) {
    let soItem: (typeof soItems)[number] | undefined;
    if (item.salesOrderItemId) {
      soItem = soItemById.get(item.salesOrderItemId);
      if (!soItem) {
        return { ok: false, status: 404, message: `第 ${index + 1} 行明细：销售订单明细不存在` };
      }
      if (soItem.orderId !== salesOrderId) {
        return {
          ok: false,
          status: 400,
          message: `第 ${index + 1} 行明细：销售订单明细不属于该销售订单`,
        };
      }
    }

    const productName = item.productName ?? soItem?.productName;
    if (!productName) {
      return { ok: false, status: 400, message: `第 ${index + 1} 行明细缺少产品名称` };
    }

    // 生产计划数量：显式入参 > 销售订购数量（SalesOrderItem.quantity）
    const quantity = round(item.quantity ?? soItem?.quantity ?? null, DECIMAL_PRECISION.quantity);
    if (!quantity || quantity.lte(0)) {
      return { ok: false, status: 400, message: `第 ${index + 1} 行明细生产数量不合法` };
    }
    const completedQty = round(item.completedQty ?? 0, DECIMAL_PRECISION.quantity) ?? new Prisma.Decimal(0);
    const defectQty = round(item.defectQty ?? 0, DECIMAL_PRECISION.quantity) ?? new Prisma.Decimal(0);
    if (completedQty.lt(0) || defectQty.lt(0)) {
      return { ok: false, status: 400, message: `第 ${index + 1} 行明细完成 / 不良数量不合法` };
    }
    // 硬业务不变量：已完成数量不得超过生产计划数量
    //（否则派生 progress 会越界，且「完成量 > 计划量」本身无语义）
    if (completedQty.gt(quantity)) {
      return { ok: false, status: 400, message: `第 ${index + 1} 行明细完成数量不能超过生产数量` };
    }

    data.push({
      salesOrderItemId: item.salesOrderItemId ?? null,
      productName,
      spec: item.spec ?? soItem?.spec ?? null,
      quantity,
      completedQty,
      defectQty,
      unit: item.unit ?? soItem?.unit ?? 'PCS',
      supplierId: item.supplierId ?? null,
      plannedStartAt: item.plannedStartAt ? new Date(item.plannedStartAt) : null,
      plannedEndAt: item.plannedEndAt ? new Date(item.plannedEndAt) : null,
      status: item.status ?? ProductionItemStatus.PENDING,
      sort: item.sort ?? index,
      remark: item.remark ?? null,
    });

    totalQty = totalQty.plus(quantity);
    doneQty = doneQty.plus(completedQty);
  }

  // 进度 = Σ已完成数量 / Σ计划数量 × 100（schema 注明 progress「由明细汇总回写」；全程 Decimal 运算）
  const rawProgress = totalQty.lte(0)
    ? 0
    : doneQty
        .times(100)
        .div(totalQty)
        .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
        .toNumber();
  // 防御性边界：派生值一律收敛到 [0,100]
  //（行级已强制 completedQty ≤ quantity；此处为双保险，避免历史数据 / 未来放开校验时越界）
  const progress = Math.min(100, Math.max(0, rawProgress));

  return { ok: true, data, progress };
}

/**
 * 「当前用户数据范围（ALL / DEPT / SELF）+ id」的查询条件。
 * 所有 ProductionOrder 读写都必须经此条件，杜绝越权访问。
 */
async function scopedWhere(req: AuthRequest, id: string): Promise<Record<string, unknown>> {
  return applyScope({ id }, await roleScope(req, { field: 'ownerId' }));
}

function isForeignKeyError(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003';
}

function isUniqueError(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

/** 事务内业务规则冲突（明细重建的引用保护）→ 由 handler 统一转为 409 */
class ProductionRefConflictError extends Error {}

/**
 * 锁定受影响的 ProductionOrderItem 行（并发硬化）。
 *
 * 目的：把「引用计数检查（refCount）→ 明细重建」纳入同一临界区，消除 TOCTOU。
 * 否则并发创建引用同一批生产明细的 PurchaseOrderItem 时，
 * 检查通过后的 deleteMany 会由 FK `onDelete: SetNull` **静默解绑** ADR-14 成本归集链。
 *
 * 为什么 FOR UPDATE 足够：
 *   PostgreSQL 在插入带 FK 引用的行时会对父行请求 FOR KEY SHARE，
 *   而 FOR KEY SHARE 与 FOR UPDATE 冲突 ⇒ 并发 INSERT 阻塞至本事务提交；
 *   本事务提交（父行已删除）后，对方 FK 校验失败 → P2003 → 应用层显式 4xx
 *   ⇒ 由「静默解绑」变为「显式失败」。
 *
 * 约束（不得放宽）：
 *   · 只锁 `ProductionOrderItem`（真正被共享的资源）；
 *   · 必须 `ORDER BY id ASC` —— 多行锁的确定性顺序，消除 AB/BA 循环等待；
 *   · 必须在**调用方的事务**内执行（锁随该事务提交/回滚释放）；
 *   · 入参先 Set 去重 + 过滤空值；空数组直接返回（不得生成 `IN ()`）。
 */
async function lockProductionOrderItems(
  tx: Prisma.TransactionClient,
  productionOrderItemIds: Array<string | null | undefined>,
): Promise<void> {
  const ids = Array.from(
    new Set(productionOrderItemIds.filter((v): v is string => Boolean(v))),
  ).sort();
  if (ids.length === 0) return;

  await tx.$queryRaw`
    SELECT id
    FROM "ProductionOrderItem"
    WHERE id IN (${Prisma.join(ids)})
    ORDER BY id ASC
    FOR UPDATE
  `;
}

// ============ 列表 ============
export const listProductionOrders = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query = listQuerySchema.parse(req.query);
    let where: Record<string, unknown> = {};
    if (query.salesOrderId) where.salesOrderId = query.salesOrderId;
    // ProductionOrder 无 customerId 列 → 经销售订单关系筛选
    if (query.customerId) where.salesOrder = { customerId: query.customerId };
    if (query.status) where.status = query.status;
    if (query.ownerId) where.ownerId = query.ownerId;
    if (query.keyword) {
      where.OR = [
        { productionNo: { contains: query.keyword } },
        { salesOrder: { orderNo: { contains: query.keyword } } },
      ];
    }

    // 数据范围：ALL / DEPT / SELF（ownerId）；ProductionOrder 不存在公海语义，不并入 publicSea
    where = applyScope(where, await roleScope(req, { field: 'ownerId' }));

    const pageNum = Math.max(1, Number(query.page) || 1);
    const pageSizeNum = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    const [list, total] = await Promise.all([
      prisma.productionOrder.findMany({
        where,
        include: PRODUCTION_ORDER_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * pageSizeNum,
        take: pageSizeNum,
      }),
      prisma.productionOrder.count({ where }),
    ]);
    success(res, { list, total, page: pageNum, pageSize: pageSizeNum });
  } catch (e) {
    if (e instanceof z.ZodError) {
      fail(res, 400, e.errors.map((err) => err.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// ============ 详情 ============
export const getProductionOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const item = await prisma.productionOrder.findFirst({
      where: await scopedWhere(req, req.params.id),
      include: PRODUCTION_ORDER_DETAIL_INCLUDE,
    });
    if (!item) {
      fail(res, 404, '生产工单不存在');
      return;
    }
    success(res, item);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// ============ 新建 ============
export const createProductionOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = createSchema.parse(req.body);

    // SalesOrder 必须存在；ProductionOrder 无 customerId，客户经此派生（用于 OperationLog / CustomerActivity）
    const salesOrder = await prisma.salesOrder.findUnique({
      where: { id: body.salesOrderId },
      select: { id: true, orderNo: true, customerId: true },
    });
    if (!salesOrder) {
      fail(res, 400, '销售订单不存在');
      return;
    }

    const parsed = await parseItems(body.items, salesOrder.id);
    if (!parsed.ok) {
      fail(res, parsed.status, parsed.message);
      return;
    }

    if (body.ownerId) {
      const owner = await prisma.user.findUnique({ where: { id: body.ownerId }, select: { id: true } });
      if (!owner) {
        fail(res, 400, '生产负责人不存在');
        return;
      }
    }

    const status = body.status ?? ProductionStatus.DRAFT;

    // 编号分配与业务写入同事务：业务失败 → 计数一并回滚，不产生编号空洞
    const item = await prisma.$transaction(async (tx) => {
      const productionNo = await getNextNumber(tx, 'PO');

      return tx.productionOrder.create({
        data: {
          productionNo,
          salesOrderId: salesOrder.id,
          status,
          plannedStartAt: body.plannedStartAt ? new Date(body.plannedStartAt) : null,
          plannedEndAt: body.plannedEndAt ? new Date(body.plannedEndAt) : null,
          actualStartAt: body.actualStartAt ? new Date(body.actualStartAt) : null,
          actualEndAt: body.actualEndAt ? new Date(body.actualEndAt) : null,
          ownerId: body.ownerId ?? req.userId ?? null,
          workshop: body.workshop ?? null,
          requirement: body.requirement ?? null,
          progress: body.progress ?? parsed.progress ?? 0,
          remark: body.remark ?? null,
          createdBy: req.userId ?? null,
          ...(parsed.data.length > 0 ? { items: { create: parsed.data } } : {}),
        },
        include: PRODUCTION_ORDER_INCLUDE,
      });
    });

    void activityLogger.log({
      userId: req.userId ?? '',
      username: req.username ?? '',
      realName: req.realName,
      action: 'CREATE',
      module: 'fulfillment',
      businessType: BUSINESS_TYPE.PRODUCTION_ORDER,
      businessId: item.id,
      businessNo: item.productionNo,
      summary: `${req.username ?? ''} 创建了生产工单「${item.productionNo}」（来源订单 ${salesOrder.orderNo}）`,
      ip: req.ip,
      customerId: salesOrder.customerId,
    });

    created(res, item);
  } catch (e) {
    if (e instanceof z.ZodError) {
      fail(res, 400, e.errors.map((err) => err.message).join(', '));
      return;
    }
    if (isUniqueError(e)) {
      fail(res, 409, '生产单号冲突，请重试');
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// ============ 更新（局部更新；明细整表重建需先确认未被采购单引用） ============
export const updateProductionOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id, ...rest } = updateSchema.parse({ id: req.params.id, ...req.body });

    const existing = await prisma.productionOrder.findFirst({
      where: await scopedWhere(req, id),
      select: { id: true, productionNo: true, salesOrderId: true },
    });
    if (!existing) {
      fail(res, 404, '生产工单不存在');
      return;
    }
    if (rest.salesOrderId !== undefined && rest.salesOrderId !== existing.salesOrderId) {
      fail(res, 400, '不支持修改所属销售订单，请重建生产工单');
      return;
    }

    const data: Prisma.ProductionOrderUpdateInput = {};
    // 明细重建内容（在事务内注入 data）与由明细派生的进度
    let parsedItemRows: Prisma.ProductionOrderItemUncheckedCreateWithoutProductionOrderInput[] | null =
      null;
    let progress: number | null = null;

    if (rest.items !== undefined) {
      // 行级校验与快照解析为纯计算（不触碰受保护资源），可在事务外先行完成
      const parsed = await parseItems(rest.items, existing.salesOrderId);
      if (!parsed.ok) {
        fail(res, parsed.status, parsed.message);
        return;
      }
      parsedItemRows = parsed.data;
      progress = parsed.progress;
    }

    if (rest.status !== undefined) data.status = rest.status;
    if (rest.plannedStartAt !== undefined) {
      data.plannedStartAt = rest.plannedStartAt ? new Date(rest.plannedStartAt) : null;
    }
    if (rest.plannedEndAt !== undefined) {
      data.plannedEndAt = rest.plannedEndAt ? new Date(rest.plannedEndAt) : null;
    }
    if (rest.actualStartAt !== undefined) {
      data.actualStartAt = rest.actualStartAt ? new Date(rest.actualStartAt) : null;
    }
    if (rest.actualEndAt !== undefined) {
      data.actualEndAt = rest.actualEndAt ? new Date(rest.actualEndAt) : null;
    }
    if (rest.ownerId !== undefined) {
      // ProductionOrderUpdateInput 不暴露 ownerId 标量（该字段带 User relation），必须走 relation
      data.owner = rest.ownerId ? { connect: { id: rest.ownerId } } : { disconnect: true };
    }
    if (rest.workshop !== undefined) data.workshop = rest.workshop;
    if (rest.requirement !== undefined) data.requirement = rest.requirement;
    if (rest.remark !== undefined) data.remark = rest.remark;
    if (rest.progress !== undefined) data.progress = rest.progress;
    else if (progress !== null) data.progress = progress;
    data.updatedBy = req.userId ?? null;

    // 明细重建的「引用保护 + 重建 + 落库」必须整体原子，且必须在读取 refCount **之前**锁定旧明细行：
    //   BEGIN → lock ProductionOrderItem(id ASC) → read refCount → assert
    //         → deleteMany/create items → update ProductionOrder → COMMIT
    // 若先读 refCount 再锁，仍存在 TOCTOU：并发 FK 插入可在窗口内提交 → onDelete: SetNull 静默解绑成本归集链。
    const item = await prisma.$transaction(async (tx) => {
      if (parsedItemRows !== null) {
        // 1) 取得本次将被删除的旧明细 id（加锁目标 + 引用计数范围）
        const existingItems = await tx.productionOrderItem.findMany({
          where: { productionOrderId: existing.id },
          select: { id: true },
        });
        const existingItemIds = existingItems.map((i) => i.id);

        // 2) **先锁行**（id ASC）：并发插入指向这些行的 PurchaseOrderItem 会被
        //    PostgreSQL FK 的 FOR KEY SHARE 阻塞，直至本事务提交
        await lockProductionOrderItems(tx, existingItemIds);

        // 3) 锁**之后**才读引用计数（顺序不可颠倒，否则仍是 TOCTOU）
        if (existingItemIds.length > 0) {
          const refCount = await tx.purchaseOrderItem.count({
            where: { productionOrderItemId: { in: existingItemIds } },
          });
          if (refCount > 0) {
            throw new ProductionRefConflictError('生产明细已被采购单引用，无法重建明细');
          }
        }

        data.items = { deleteMany: {}, create: parsedItemRows };
      }

      return tx.productionOrder.update({
        where: { id },
        data,
        include: PRODUCTION_ORDER_INCLUDE,
      });
    });

    const customerId = item.salesOrder?.customerId;
    void activityLogger.log({
      userId: req.userId ?? '',
      username: req.username ?? '',
      realName: req.realName,
      action: 'UPDATE',
      module: 'fulfillment',
      businessType: BUSINESS_TYPE.PRODUCTION_ORDER,
      businessId: item.id,
      businessNo: item.productionNo,
      summary: `${req.username ?? ''} 更新了生产工单「${item.productionNo}」`,
      ip: req.ip,
      customerId,
    });

    success(res, item, '更新成功');
  } catch (e) {
    if (e instanceof z.ZodError) {
      fail(res, 400, e.errors.map((err) => err.message).join(', '));
      return;
    }
    if (e instanceof ProductionRefConflictError) {
      fail(res, 409, e.message);
      return;
    }
    if (isForeignKeyError(e)) {
      fail(res, 409, '生产明细被下游单据引用，无法重建明细');
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// ============ 删除 ============
export const removeProductionOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const existing = await prisma.productionOrder.findFirst({
      where: await scopedWhere(req, req.params.id),
      select: { id: true, productionNo: true, salesOrder: { select: { customerId: true } } },
    });
    if (!existing) {
      fail(res, 404, '生产工单不存在');
      return;
    }

    // ProductionOrder → QualityInspection 为 Restrict，存在质检记录时数据库拒绝删除；
    // PurchaseOrder.productionOrderId 为 SetNull，明细为 Cascade（均遵守 schema，不自行改变 relation）。
    await prisma.productionOrder.delete({ where: { id: existing.id } });

    void activityLogger.log({
      userId: req.userId ?? '',
      username: req.username ?? '',
      realName: req.realName,
      action: 'DELETE',
      module: 'fulfillment',
      businessType: BUSINESS_TYPE.PRODUCTION_ORDER,
      businessId: existing.id,
      businessNo: existing.productionNo,
      summary: `${req.username ?? ''} 删除了生产工单「${existing.productionNo}」`,
      ip: req.ip,
      customerId: existing.salesOrder?.customerId,
    });

    success(res, null, '删除成功');
  } catch (e) {
    if (isForeignKeyError(e)) {
      fail(res, 409, '该生产工单存在质检等下游单据，无法删除');
      return;
    }
    fail(res, 500, '服务器错误');
  }
};
