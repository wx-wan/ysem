import { Currency, Prisma, PurchaseItemStatus, PurchaseStatus, PurchaseType } from '@prisma/client';
import { z } from 'zod';
import { activityLogger } from '../lib/activity-logger';
import { BUSINESS_TYPE } from '../lib/business-type';
import { DomainConflictError, DomainNotFoundError, DomainValidationError } from '../lib/errors';
import {
  createPurchaseOrderAggregate,
  updatePurchaseOrderAggregate,
  type ItemsPlanResult,
  type PreservedItemState,
  type PurchaseItemsContext,
} from '../operations/procurement.operations';
import {
  productionOrderRepository,
  purchaseOrderRepository,
  salesOrderRepository,
  supplierRepository,
  userRepository,
} from '../repositories';
import { DECIMAL_PRECISION, round, toCny, toDecimal } from '../utils/currency';
import { applyScope } from '../utils/scope';
import { resolveExchangeRate, type SalesActorContext } from './salesProcess.shared';

/**
 * PurchaseOrder Business Layer —— Round R-5 · Phase 4 · D1-a 采购域
 *
 * 采购单是独立实体：向供应商的采购 / 外发需求，**不是** SalesOrder / ProductionOrder / Shipment。
 *   · 明细一律落 PurchaseOrderItem 关系表（不得 `JSON.stringify(items)`）；
 *   · 成本归集链：SalesOrderItem → ProductionOrderItem → PurchaseOrderItem → PurchaseOrder（ADR-14）。
 *
 * 【服务端权威派生字段（P0）】
 *   PurchaseOrderItem.amount      = quantity × unitPrice（客户端传入被忽略）
 *   PurchaseOrder.totalAmount     = Σ(PurchaseOrderItem.amount)
 *   PurchaseOrder.totalAmountCny  = totalAmount × rateToCny（无汇率 → NULL，**不伪造**）
 *
 * 已 Deferred：purchaseNo 走 NumberSequence 之外的编号策略、审批流转、
 *   PurchaseOrder → Profit 成本自动归集（ADR-14 闭环）、arrivedQty → PurchaseItemStatus 自动同步。
 *
 * 约束：不读 req / res、不出现 `$transaction`、不直接 import Prisma 单例。
 */

// ============================================================
// DTO
// ============================================================

const amountSchema = z.union([z.number(), z.string()]);

export const purchaseOrderItemSchema = z.object({
  productId: z.string().optional().nullable(),
  productionOrderItemId: z.string().optional().nullable(),
  itemName: z.string().min(1, '采购明细名称不能为空'),
  spec: z.string().optional().nullable(),
  quantity: amountSchema,
  unit: z.string().optional(),
  unitPrice: amountSchema,
  // 兼容入参：金额由服务端按 quantity × unitPrice 权威计算，客户端传入值被忽略
  amount: amountSchema.optional(),
  currency: z.nativeEnum(Currency).optional().nullable(),
  arrivedQty: amountSchema.optional(),
  status: z.nativeEnum(PurchaseItemStatus).optional(),
  remark: z.string().optional().nullable(),
});

export const purchaseOrderCreateSchema = z.object({
  salesOrderId: z.string().optional().nullable(),
  productionOrderId: z.string().optional().nullable(),
  supplierId: z.string().optional().nullable(),
  purchaseDate: z.string().optional().nullable(),
  status: z.nativeEnum(PurchaseStatus).optional(),
  expectedArrivalAt: z.string().optional().nullable(),
  arrivedAt: z.string().optional().nullable(),
  currency: z.nativeEnum(Currency).optional(),
  exchangeRate: amountSchema.optional().nullable(),
  purchaseType: z.nativeEnum(PurchaseType).optional(),
  ownerId: z.string().optional().nullable(),
  remark: z.string().optional().nullable(),
  items: z.array(purchaseOrderItemSchema).optional(),
});

export const purchaseOrderUpdateSchema = purchaseOrderCreateSchema.partial().extend({
  id: z.string().min(1),
});

export const purchaseOrderListQuerySchema = z.object({
  keyword: z.string().optional(),
  search: z.string().optional(),
  status: z.nativeEnum(PurchaseStatus).optional(),
  supplierId: z.string().optional(),
  salesOrderId: z.string().optional(),
  productionOrderId: z.string().optional(),
  purchaseType: z.nativeEnum(PurchaseType).optional(),
  page: z.union([z.string(), z.number()]).optional(),
  pageSize: z.union([z.string(), z.number()]).optional(),
});

export type PurchaseOrderItemInput = z.infer<typeof purchaseOrderItemSchema>;
export type PurchaseOrderCreateInput = z.infer<typeof purchaseOrderCreateSchema>;
export type PurchaseOrderUpdateInput = Omit<z.infer<typeof purchaseOrderUpdateSchema>, 'id'>;
export type PurchaseOrderListQuery = z.infer<typeof purchaseOrderListQuerySchema>;

/** 列表 / 详情统一 include：供应商、来源销售订单 / 生产工单、明细 */
const PURCHASE_ORDER_INCLUDE = {
  supplier: { select: { id: true, supplierNo: true, name: true, contact: true, phone: true } },
  salesOrder: { select: { id: true, orderNo: true, status: true } },
  productionOrder: { select: { id: true, productionNo: true, status: true } },
  items: { orderBy: { lineNo: 'asc' as const } },
} satisfies Prisma.PurchaseOrderInclude;

type PurchaseOrderRow = Prisma.PurchaseOrderGetPayload<{ include: typeof PURCHASE_ORDER_INCLUDE }>;

// ============================================================
// 明细构建（纯函数：不触库、不触 tx）
// ============================================================

/**
 * 采购明细解析（ADR-14 快照 + 服务端权威金额）。
 *
 * 快照：itemName / spec / quantity / unit / unitPrice / amount / currency 全部落入明细自身，
 * 历史采购价与名称不依赖 Product 后续变化（Product 仅做存在性校验，不复制数据）。
 * 币种：一张采购单只允许一种币种；明细未提供时继承单据币种，显式不一致 → 400。
 *
 * 校验顺序与迁移前逐字一致：币种一致性 → 产品存在性(404) → 生产明细存在性(404)
 *   → 逐行数量/单价/到货量(400) → 跨工单绑定(400)。
 */
function buildItemsPlan(args: {
  ctx: PurchaseItemsContext;
  rawItems: PurchaseOrderItemInput[];
  currency: Currency;
  productionOrderId: string | null;
}): ItemsPlanResult {
  const { ctx, rawItems, currency } = args;
  if (rawItems.length === 0) {
    return { ok: true, data: [], total: new Prisma.Decimal(0) };
  }

  // 币种一致性（不支持一张单多币种混算）
  for (const [index, item] of rawItems.entries()) {
    if (item.currency && item.currency !== currency) {
      return {
        ok: false,
        status: 400,
        message: `第 ${index + 1} 行明细币种（${item.currency}）与采购单币种（${currency}）不一致`,
      };
    }
  }

  // 关联主数据存在性（复用同一对象级授权边界；不可见与不存在同结果）
  if (ctx.visibleProductIds.length !== ctx.requestedProductIds.length) {
    return { ok: false, status: 404, message: '产品不存在' };
  }

  const requestedProdItemIds = Array.from(
    new Set(rawItems.map((i) => i.productionOrderItemId).filter((v): v is string => Boolean(v))),
  );
  if (ctx.productionItems.length !== requestedProdItemIds.length) {
    return { ok: false, status: 404, message: '生产明细不存在' };
  }
  const prodItemById = new Map(ctx.productionItems.map((i) => [i.id, i]));

  const data: Prisma.PurchaseOrderItemUncheckedCreateWithoutPurchaseOrderInput[] = [];
  let total = new Prisma.Decimal(0);

  for (const [index, item] of rawItems.entries()) {
    const lineNo = index + 1;

    const quantity = round(item.quantity, DECIMAL_PRECISION.quantity);
    if (!quantity || quantity.lte(0)) {
      return { ok: false, status: 400, message: `第 ${lineNo} 行明细数量不合法` };
    }
    const unitPrice = round(item.unitPrice, DECIMAL_PRECISION.unitPrice);
    if (!unitPrice || unitPrice.lt(0)) {
      return { ok: false, status: 400, message: `第 ${lineNo} 行明细单价不合法` };
    }

    // 服务端权威金额：amount = quantity × unitPrice（不采纳客户端传入的 amount）
    const amount = quantity
      .times(unitPrice)
      .toDecimalPlaces(DECIMAL_PRECISION.amount, Prisma.Decimal.ROUND_HALF_UP);

    const preserved: PreservedItemState | undefined = ctx.preserveByLine?.get(lineNo);
    const arrivedQty =
      item.arrivedQty !== undefined
        ? round(item.arrivedQty, DECIMAL_PRECISION.quantity) ?? new Prisma.Decimal(0)
        : preserved?.arrivedQty ?? new Prisma.Decimal(0);
    if (arrivedQty.lt(0)) {
      return { ok: false, status: 400, message: `第 ${lineNo} 行明细到货数量不合法` };
    }

    data.push({
      lineNo,
      productId: item.productId ?? null,
      productionOrderItemId: item.productionOrderItemId ?? null,
      itemName: item.itemName,
      spec: item.spec ?? null,
      quantity,
      unit: item.unit ?? 'PCS',
      unitPrice,
      amount,
      currency,
      arrivedQty,
      status: item.status ?? preserved?.status ?? PurchaseItemStatus.PENDING,
      remark: item.remark ?? null,
    });

    total = total.plus(amount);
  }

  // 明细中的 productionOrderItemId 必须属于同一生产工单（防跨工单错绑）
  if (args.productionOrderId) {
    for (const [index, item] of rawItems.entries()) {
      if (!item.productionOrderItemId) continue;
      const prodItem = prodItemById.get(item.productionOrderItemId);
      if (prodItem && prodItem.productionOrderId !== args.productionOrderId) {
        return {
          ok: false,
          status: 400,
          message: `第 ${index + 1} 行明细的生产明细不属于指定生产工单`,
        };
      }
    }
  }

  return {
    ok: true,
    data,
    total: total.toDecimalPlaces(DECIMAL_PRECISION.amount, Prisma.Decimal.ROUND_HALF_UP),
  };
}

// ============================================================
// 引用 / 归属校验
// ============================================================

/**
 * 关联实体存在性校验。
 *  · Supplier = 共享采购主数据（DQ-4=A）：仅存在性，**不施加** owner 数据范围；
 *  · SalesOrder / ProductionOrder = 业务归属对象（P5-REF-01=ACCEPT）：引用必须落在当前用户
 *    ownerId 数据范围内；scope 外与不存在同响应 404（无存在性泄露）。
 */
async function assertRefsExist(
  input: { supplierId?: string | null; salesOrderId?: string | null; productionOrderId?: string | null },
  ctx: SalesActorContext,
): Promise<void> {
  if (input.supplierId) {
    const supplier = await supplierRepository.findById(input.supplierId);
    if (!supplier) throw new DomainNotFoundError('供应商不存在');
  }
  const ownerScope = await ctx.scope.owner();
  if (input.salesOrderId) {
    const salesOrder = await salesOrderRepository.findFirst({
      where: applyScope({ id: input.salesOrderId }, ownerScope) as Prisma.SalesOrderWhereInput,
      select: { id: true },
    });
    if (!salesOrder) throw new DomainNotFoundError('销售订单不存在');
  }
  if (input.productionOrderId) {
    const productionOrder = await productionOrderRepository.findFirst({
      where: applyScope({ id: input.productionOrderId }, ownerScope) as Prisma.ProductionOrderWhereInput,
      select: { id: true },
    });
    if (!productionOrder) throw new DomainNotFoundError('生产工单不存在');
  }
}

/** 改派归属必须通过「可指派范围」校验，且**先于任何写入** */
async function assertAssignableOwner(ownerId: string | null, ctx: SalesActorContext): Promise<void> {
  if (ownerId === undefined || ownerId === null) return;
  const target = await userRepository.findScopedTransferTarget(ownerId, await ctx.scope.assignee());
  if (!target) throw new DomainValidationError('业务归属人不存在或无权限指派');
}

/** 数据范围：PurchaseOrder.ownerId 为标量（无 User relation）→ 直接复用 field 级 scope */
async function scopedWhere(
  ctx: SalesActorContext,
  base: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return applyScope(base, await ctx.scope.owner());
}

// ============================================================
// 列表 / 详情
// ============================================================

export async function list(query: PurchaseOrderListQuery, ctx: SalesActorContext) {
  const keyword = query.keyword ?? query.search;
  const base: Record<string, unknown> = {};
  if (query.status) base.status = query.status;
  if (query.supplierId) base.supplierId = query.supplierId;
  if (query.salesOrderId) base.salesOrderId = query.salesOrderId;
  if (query.productionOrderId) base.productionOrderId = query.productionOrderId;
  if (query.purchaseType) base.purchaseType = query.purchaseType;
  if (keyword) {
    base.OR = [
      { purchaseNo: { contains: keyword } },
      { remark: { contains: keyword } },
      { supplier: { name: { contains: keyword } } },
    ];
  }

  const where = (await scopedWhere(ctx, base)) as Prisma.PurchaseOrderWhereInput;
  const pageNum = Math.max(1, Number(query.page) || 1);
  const pageSizeNum = Math.min(100, Math.max(1, Number(query.pageSize) || 20));

  const [list, total] = await Promise.all([
    purchaseOrderRepository.findMany({
      where,
      include: PURCHASE_ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
      skip: (pageNum - 1) * pageSizeNum,
      take: pageSizeNum,
    }),
    purchaseOrderRepository.count(where),
  ]);
  return { list, total, page: pageNum, pageSize: pageSizeNum };
}

export async function getOne(id: string, ctx: SalesActorContext): Promise<PurchaseOrderRow> {
  const item = await purchaseOrderRepository.findFirst({
    where: (await scopedWhere(ctx, { id })) as Prisma.PurchaseOrderWhereInput,
    include: PURCHASE_ORDER_INCLUDE,
  });
  if (!item) throw new DomainNotFoundError('采购单不存在');
  return item;
}

// ============================================================
// 新建 / 更新 / 删除
// ============================================================

export async function create(body: PurchaseOrderCreateInput, ctx: SalesActorContext): Promise<PurchaseOrderRow> {
  await assertRefsExist(body, ctx);
  await assertAssignableOwner(body.ownerId ?? null, ctx);

  const currency = body.currency ?? Currency.CNY;
  const exchangeRate = await resolveExchangeRate(currency, body.exchangeRate);
  const visibilityWhere = await ctx.scope.productVisibility();

  const header: Parameters<typeof createPurchaseOrderAggregate>[0]['header'] = {
    salesOrderId: body.salesOrderId ?? null,
    productionOrderId: body.productionOrderId ?? null,
    supplierId: body.supplierId ?? null,
    purchaseDate: body.purchaseDate ? new Date(body.purchaseDate) : null,
    status: body.status ?? PurchaseStatus.DRAFT,
    expectedArrivalAt: body.expectedArrivalAt ? new Date(body.expectedArrivalAt) : null,
    arrivedAt: body.arrivedAt ? new Date(body.arrivedAt) : null,
    currency,
    exchangeRate,
    purchaseType: body.purchaseType ?? PurchaseType.MATERIAL,
    ownerId: body.ownerId ?? ctx.userId ?? null,
    remark: body.remark ?? null,
    createdBy: ctx.userId ?? null,
  };

  let result: Awaited<ReturnType<typeof createPurchaseOrderAggregate<typeof PURCHASE_ORDER_INCLUDE>>>;
  try {
    result = await createPurchaseOrderAggregate(
      {
        rawItems: body.items,
        visibilityWhere,
        header,
        toTotalCny: (total) => toCny(total, exchangeRate),
        plan: (c) =>
          buildItemsPlan({
            ctx: c,
            rawItems: body.items ?? [],
            currency,
            productionOrderId: body.productionOrderId ?? null,
          }),
        include: PURCHASE_ORDER_INCLUDE,
      },
    );
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new DomainConflictError('采购单号冲突，请重试');
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
      throw new DomainConflictError('采购单关联数据冲突');
    }
    throw e;
  }

  const item = result.order;
  // 采购单不属于 Customer 生命周期事件 → 不写 CustomerActivity（不传 customerId）
  void activityLogger.log({
    userId: ctx.userId ?? '',
    username: ctx.username ?? '',
    realName: ctx.realName,
    action: 'CREATE',
    module: 'fulfillment',
    businessType: BUSINESS_TYPE.PURCHASE_ORDER,
    businessId: item.id,
    businessNo: item.purchaseNo,
    summary: `${ctx.username ?? ''} 创建了采购单「${item.purchaseNo}」（${result.itemCount} 条明细）`,
    ip: ctx.ip,
  });

  return item;
}

export async function update(
  id: string,
  rest: PurchaseOrderUpdateInput,
  ctx: SalesActorContext,
): Promise<PurchaseOrderRow> {
  const existing = await purchaseOrderRepository.findFirst({
    where: (await scopedWhere(ctx, { id })) as Prisma.PurchaseOrderWhereInput,
    select: {
      id: true,
      purchaseNo: true,
      currency: true,
      totalAmount: true,
      productionOrderId: true,
      salesOrderId: true,
      supplierId: true,
    },
  });
  if (!existing) throw new DomainNotFoundError('采购单不存在');

  await assertRefsExist(
    {
      supplierId: rest.supplierId !== undefined ? rest.supplierId : existing.supplierId,
      salesOrderId: rest.salesOrderId !== undefined ? rest.salesOrderId : existing.salesOrderId,
      productionOrderId:
        rest.productionOrderId !== undefined ? rest.productionOrderId : existing.productionOrderId,
    },
    ctx,
  );

  // D-C4-B（Option B，UPDATE）：改派归属必须通过数据范围校验，且先于任何写入
  if (rest.ownerId !== undefined) await assertAssignableOwner(rest.ownerId, ctx);

  const currency = rest.currency ?? existing.currency;
  const nextProductionOrderId =
    rest.productionOrderId !== undefined ? rest.productionOrderId : existing.productionOrderId;

  // 汇率解析：仅在「明细重建 或 币种/汇率变化」时才需要（与迁移前分支条件逐字一致）。
  // 实现说明：迁移前该解析位于事务内；本轮移至事务外（只读 DailyExchangeRate 主数据，
  // 语义等价），使事务内不再出现异步业务调用。
  const needsRecalc =
    rest.items !== undefined || rest.currency !== undefined || rest.exchangeRate !== undefined;
  const exchangeRate = needsRecalc
    ? await resolveExchangeRate(currency, rest.exchangeRate !== undefined ? rest.exchangeRate : null)
    : null;

  const visibilityWhere = await ctx.scope.productVisibility();

  // 入参收窄为成功分支：失败分支已在 Operation 内抛错，不会到达此处
  const buildData = (
    plan: Extract<ItemsPlanResult, { ok: true }> | null,
  ): Prisma.PurchaseOrderUncheckedUpdateInput => {
    const data: Prisma.PurchaseOrderUncheckedUpdateInput = { updatedBy: ctx.userId ?? null };

    if (rest.salesOrderId !== undefined) data.salesOrderId = rest.salesOrderId;
    if (rest.productionOrderId !== undefined) data.productionOrderId = rest.productionOrderId;
    if (rest.supplierId !== undefined) data.supplierId = rest.supplierId;
    if (rest.purchaseDate !== undefined) {
      data.purchaseDate = rest.purchaseDate ? new Date(rest.purchaseDate) : null;
    }
    if (rest.status !== undefined) data.status = rest.status;
    if (rest.expectedArrivalAt !== undefined) {
      data.expectedArrivalAt = rest.expectedArrivalAt ? new Date(rest.expectedArrivalAt) : null;
    }
    if (rest.arrivedAt !== undefined) {
      data.arrivedAt = rest.arrivedAt ? new Date(rest.arrivedAt) : null;
    }
    if (rest.currency !== undefined) data.currency = currency;
    if (rest.purchaseType !== undefined) data.purchaseType = rest.purchaseType;
    if (rest.ownerId !== undefined) data.ownerId = rest.ownerId;
    if (rest.remark !== undefined) data.remark = rest.remark;

    if (plan) data.items = { deleteMany: {}, create: plan.data };

    // 金额/汇率重算：明细重建 或 币种/汇率变化 时统一按 rateToCny 重算三件套
    if (plan !== null || rest.currency !== undefined || rest.exchangeRate !== undefined) {
      const totalAmount = plan?.total ?? toDecimal(existing.totalAmount) ?? new Prisma.Decimal(0);
      data.totalAmount = totalAmount;
      data.exchangeRate = exchangeRate;
      data.totalAmountCny = toCny(totalAmount, exchangeRate);
    }

    return data;
  };

  let item: PurchaseOrderRow;
  try {
    item = await updatePurchaseOrderAggregate({
      id: existing.id,
      rawItems: rest.items ?? null,
      visibilityWhere,
      plan:
        rest.items !== undefined
          ? (c) =>
              buildItemsPlan({
                ctx: c,
                rawItems: rest.items ?? [],
                currency,
                productionOrderId: nextProductionOrderId ?? null,
              })
          : null,
      buildData,
      include: PURCHASE_ORDER_INCLUDE,
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
      throw new DomainConflictError('采购明细已被下游单据引用，无法重建明细');
    }
    throw e;
  }

  void activityLogger.log({
    userId: ctx.userId ?? '',
    username: ctx.username ?? '',
    realName: ctx.realName,
    action: 'UPDATE',
    module: 'fulfillment',
    businessType: BUSINESS_TYPE.PURCHASE_ORDER,
    businessId: item.id,
    businessNo: item.purchaseNo,
    summary: `${ctx.username ?? ''} 更新了采购单「${item.purchaseNo}」`,
    ip: ctx.ip,
  });

  return item;
}

export async function remove(id: string, ctx: SalesActorContext): Promise<void> {
  const existing = await purchaseOrderRepository.findFirst({
    where: (await scopedWhere(ctx, { id })) as Prisma.PurchaseOrderWhereInput,
    select: { id: true, purchaseNo: true },
  });
  if (!existing) throw new DomainNotFoundError('采购单不存在');

  // PurchaseOrder → SalesOrder / Supplier / Payment 为 Restrict，明细为 Cascade：
  // 存在下游引用时由数据库拒绝（不自行改变 relation）。
  try {
    await purchaseOrderRepository.delete(existing.id);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
      throw new DomainConflictError('该采购单存在收付款等下游单据，无法删除');
    }
    throw e;
  }

  void activityLogger.log({
    userId: ctx.userId ?? '',
    username: ctx.username ?? '',
    realName: ctx.realName,
    action: 'DELETE',
    module: 'fulfillment',
    businessType: BUSINESS_TYPE.PURCHASE_ORDER,
    businessId: existing.id,
    businessNo: existing.purchaseNo,
    summary: `${ctx.username ?? ''} 删除了采购单「${existing.purchaseNo}」`,
    ip: ctx.ip,
  });
}

export type { PurchaseOrderRow };
export type { PreservedItemState };
