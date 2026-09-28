import { Prisma, ProductionItemStatus, ProductionStatus } from '@prisma/client';
import { z } from 'zod';
import { activityLogger } from '../lib/activity-logger';
import { BUSINESS_TYPE } from '../lib/business-type';
import { DomainConflictError, DomainNotFoundError, DomainValidationError } from '../lib/errors';
import {
  createProductionOrderAggregate,
  updateProductionOrderAggregate,
} from '../operations/production.operations';
import {
  productionOrderRepository,
  salesOrderRepository,
  supplierRepository,
  userRepository,
} from '../repositories';
import { checkProductionStatusTransition } from '../state';
import { DECIMAL_PRECISION, round } from '../utils/currency';
import { applyScope } from '../utils/scope';
import type { SalesActorContext } from './salesProcess.shared';

/**
 * ProductionOrder Business Layer —— Round R-5 · Phase 4 · D1-b 生产质量域
 *
 * 履约链：SalesOrder → ProductionOrder → ProductionOrderItem
 *  - ProductionOrder 是唯一的正式生产执行单实体，**不得**回退到 Order(type=PRODUCTION)；
 *  - 明细一律落 ProductionOrderItem（结构化），**不得**使用 JSON items / 旧 OrderItem；
 *  - 生产状态使用 ProductionStatus，**不得**复用 SalesOrderStatus / 旧 Order.status / 旧 stage；
 *  - ProductionOrder **无 customerId / 无金额三件套**（客户经 salesOrder 派生，成本走 PurchaseOrder → Profit）。
 *
 * 已 Deferred（继续不做）：审批流转、Shipment / Payment / Profit 业务逻辑（仅详情只读 include）、
 * 出货数量（SalesOrderItem.shippedQty 由 ShipmentItem 汇总回写，属 D1-c）、生产成本归集闭环。
 *
 * 约束：不读 req / res、不出现 `$transaction`、不直接 import Prisma 单例。
 */

// ============================================================
// DTO
// ============================================================

const amountSchema = z.union([z.number(), z.string()]);

export const productionOrderItemSchema = z.object({
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

export const productionOrderCreateSchema = z.object({
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
  items: z.array(productionOrderItemSchema).optional(),
});

export const productionOrderUpdateSchema = productionOrderCreateSchema.partial().extend({
  id: z.string().min(1),
  // 所属销售订单为不可变上游关系；显式传入仅用于给出 400 提示
  salesOrderId: z.string().optional(),
});

export const productionOrderListQuerySchema = z.object({
  salesOrderId: z.string().optional(),
  customerId: z.string().optional(),
  status: z.nativeEnum(ProductionStatus).optional(),
  ownerId: z.string().optional(),
  keyword: z.string().optional(),
  page: z.union([z.string(), z.number()]).optional(),
  pageSize: z.union([z.string(), z.number()]).optional(),
});

export type ProductionOrderItemInput = z.infer<typeof productionOrderItemSchema>;
export type ProductionOrderCreateInput = z.infer<typeof productionOrderCreateSchema>;
export type ProductionOrderUpdateInput = Omit<z.infer<typeof productionOrderUpdateSchema>, 'id'>;
export type ProductionOrderListQuery = z.infer<typeof productionOrderListQuerySchema>;

/** 列表统一 include：销售订单（客户经此派生）、明细（含供应商） */
const PRODUCTION_ORDER_INCLUDE = {
  salesOrder: { select: { id: true, orderNo: true, status: true, customerId: true } },
  items: {
    orderBy: [{ sort: 'asc' as const }, { createdAt: 'asc' as const }],
    include: { supplier: { select: { id: true, name: true } } },
  },
} satisfies Prisma.ProductionOrderInclude;

/** 详情额外只读 include 下游单据（不实现其业务逻辑） */
const PRODUCTION_ORDER_DETAIL_INCLUDE = {
  ...PRODUCTION_ORDER_INCLUDE,
  salesOrder: {
    select: {
      id: true,
      orderNo: true,
      status: true,
      customerId: true,
      currency: true,
      customer: { select: { id: true, customerNo: true, companyName: true } },
    },
  },
  owner: { select: { id: true, username: true, realName: true } },
  inspections: { select: { id: true, inspectionNo: true, type: true, result: true } },
  purchaseOrders: { select: { id: true, purchaseNo: true, status: true } },
} satisfies Prisma.ProductionOrderInclude;

// ============================================================
// 明细解析 + 快照（纯函数：不触库、不触 tx）
// ============================================================

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
 *
 * 校验顺序与迁移前逐字一致：供应商存在性(400) → 逐行（销售明细不存在 404 /
 * 不属于该销售订单 400 / 缺产品名 400 / 数量不合法 400 / 完成与不良为负 400 / 完成量超计划 400）。
 */
function buildItemsPlan(input: {
  raw: ProductionOrderItemInput[] | undefined;
  salesOrderId: string;
  salesOrderItems: ReadonlyArray<{
    id: string;
    orderId: string;
    productName: string;
    spec: string | null;
    quantity: Prisma.Decimal;
    unit: string;
  }>;
  existingSupplierIds: string[];
}): ParsedItemsOk | ParsedItemsFail {
  const { raw, salesOrderId } = input;
  if (!raw || raw.length === 0) return { ok: true, data: [], progress: null };

  const soItemById = new Map(input.salesOrderItems.map((i) => [i.id, i]));

  // 供应商存在性校验（一次批量查询；注意：原文案与状态码为 400 / '供应商不存在'）
  const supplierIds = Array.from(
    new Set(raw.map((i) => i.supplierId).filter((v): v is string => Boolean(v))),
  );
  if (supplierIds.length > 0 && input.existingSupplierIds.length !== supplierIds.length) {
    return { ok: false, status: 400, message: '供应商不存在' };
  }

  const data: Prisma.ProductionOrderItemUncheckedCreateWithoutProductionOrderInput[] = [];
  let totalQty = new Prisma.Decimal(0);
  let doneQty = new Prisma.Decimal(0);

  for (const [index, item] of raw.entries()) {
    let soItem: (typeof input.salesOrderItems)[number] | undefined;
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
  const progress = Math.min(100, Math.max(0, rawProgress));

  return { ok: true, data, progress };
}

/** 加载明细解析所需的数据（事务外；`parseItems` 原本即不在事务内） */
async function loadItemsPlanInput(raw: ProductionOrderItemInput[] | undefined, salesOrderId: string) {
  const soItemIds = Array.from(
    new Set((raw ?? []).map((i) => i.salesOrderItemId).filter((v): v is string => Boolean(v))),
  );
  const supplierIds = Array.from(
    new Set((raw ?? []).map((i) => i.supplierId).filter((v): v is string => Boolean(v))),
  );
  const [salesOrderItems, existingSupplierIds] = await Promise.all([
    salesOrderRepository.findItemsByIds(soItemIds),
    supplierRepository.findExistingIds(supplierIds),
  ]);
  return { salesOrderItems, existingSupplierIds };
}

// ============================================================
// Scope / 归属
// ============================================================

/**
 * 「当前用户数据范围（ALL / DEPT / SELF）+ id」的查询条件。
 * 所有 ProductionOrder 读写都必须经此条件，杜绝越权访问。
 * ProductionOrder 不存在公海语义，不并入 publicSea。
 */
async function scopedWhere(
  ctx: SalesActorContext,
  base: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return applyScope(base, await ctx.scope.owner());
}

/** 生产负责人必须通过「可指派范围」校验（`ownerId` 为标量，见 schema） */
async function assertAssignableOwner(ownerId: string | null, ctx: SalesActorContext): Promise<void> {
  if (ownerId === undefined || ownerId === null) return;
  const target = await userRepository.findScopedTransferTarget(ownerId, await ctx.scope.assignee());
  if (!target) throw new DomainValidationError('生产负责人不存在或无权限指派');
}

// ============================================================
// 列表 / 详情
// ============================================================

export async function list(query: ProductionOrderListQuery, ctx: SalesActorContext) {
  const where: Record<string, unknown> = {};
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

  const scoped = (await scopedWhere(ctx, where)) as Prisma.ProductionOrderWhereInput;
  const pageNum = Math.max(1, Number(query.page) || 1);
  const pageSizeNum = Math.min(100, Math.max(1, Number(query.pageSize) || 20));

  const [list, total] = await Promise.all([
    productionOrderRepository.findMany({
      where: scoped,
      include: PRODUCTION_ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
      skip: (pageNum - 1) * pageSizeNum,
      take: pageSizeNum,
    }),
    productionOrderRepository.count(scoped),
  ]);
  return { list, total, page: pageNum, pageSize: pageSizeNum };
}

export async function getOne(id: string, ctx: SalesActorContext) {
  const item = await productionOrderRepository.findFirst({
    where: (await scopedWhere(ctx, { id })) as Prisma.ProductionOrderWhereInput,
    include: PRODUCTION_ORDER_DETAIL_INCLUDE,
  });
  if (!item) throw new DomainNotFoundError('生产工单不存在');
  return item;
}

// ============================================================
// 新建
// ============================================================

export async function create(body: ProductionOrderCreateInput, ctx: SalesActorContext) {
  // SalesOrder 必须存在**且在本用户数据范围内**（F-3C4-03：SalesOrder.ownerId）；
  // ProductionOrder 无 customerId，客户经此派生（用于 OperationLog / CustomerActivity）。
  // 不可见与不存在统一 404（不泄露他人销售订单是否存在）。
  const salesOrder = await salesOrderRepository.findFirst({
    where: applyScope({ id: body.salesOrderId }, await ctx.scope.owner()) as Prisma.SalesOrderWhereInput,
    select: { id: true, orderNo: true, customerId: true },
  });
  if (!salesOrder) throw new DomainNotFoundError('销售订单不存在');

  const planInput = await loadItemsPlanInput(body.items, salesOrder.id);
  const parsed = buildItemsPlan({ raw: body.items, salesOrderId: salesOrder.id, ...planInput });
  if (!parsed.ok) {
    throw parsed.status === 404 ? new DomainNotFoundError(parsed.message) : new DomainValidationError(parsed.message);
  }

  await assertAssignableOwner(body.ownerId ?? null, ctx);

  let item;
  try {
    item = await createProductionOrderAggregate({
      data: {
        salesOrderId: salesOrder.id,
        status: body.status ?? ProductionStatus.DRAFT,
        plannedStartAt: body.plannedStartAt ? new Date(body.plannedStartAt) : null,
        plannedEndAt: body.plannedEndAt ? new Date(body.plannedEndAt) : null,
        actualStartAt: body.actualStartAt ? new Date(body.actualStartAt) : null,
        actualEndAt: body.actualEndAt ? new Date(body.actualEndAt) : null,
        ownerId: body.ownerId ?? ctx.userId ?? null,
        workshop: body.workshop ?? null,
        requirement: body.requirement ?? null,
        progress: body.progress ?? parsed.progress ?? 0,
        remark: body.remark ?? null,
        createdBy: ctx.userId ?? null,
        ...(parsed.data.length > 0 ? { items: { create: parsed.data } } : {}),
      },
      include: PRODUCTION_ORDER_INCLUDE,
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new DomainConflictError('生产单号冲突，请重试');
    }
    throw e;
  }

  void activityLogger.log({
    userId: ctx.userId ?? '',
    username: ctx.username ?? '',
    realName: ctx.realName,
    action: 'CREATE',
    module: 'fulfillment',
    businessType: BUSINESS_TYPE.PRODUCTION_ORDER,
    businessId: item.id,
    businessNo: item.productionNo,
    summary: `${ctx.username ?? ''} 创建了生产工单「${item.productionNo}」（来源订单 ${salesOrder.orderNo}）`,
    ip: ctx.ip,
    customerId: salesOrder.customerId,
  });

  return item;
}

// ============================================================
// 更新（局部更新；明细整表重建需先确认未被采购单引用）
// ============================================================

export async function update(id: string, rest: ProductionOrderUpdateInput, ctx: SalesActorContext) {
  const existing = await productionOrderRepository.findFirst({
    where: (await scopedWhere(ctx, { id })) as Prisma.ProductionOrderWhereInput,
    // status / progress：状态转移 Gate 与 COMPLETED progress 前置所需（scope 通过后才读取）
    select: { id: true, productionNo: true, salesOrderId: true, status: true, progress: true },
  });
  if (!existing) throw new DomainNotFoundError('生产工单不存在');
  if (rest.salesOrderId !== undefined && rest.salesOrderId !== existing.salesOrderId) {
    throw new DomainValidationError('不支持修改所属销售订单，请重建生产工单');
  }

  const data: Prisma.ProductionOrderUpdateInput = {};
  let parsedItemRows: Prisma.ProductionOrderItemUncheckedCreateWithoutProductionOrderInput[] | null = null;
  let progress: number | null = null;

  if (rest.items !== undefined) {
    // 行级校验与快照解析为纯计算（不触碰受保护资源），在事务外先行完成
    const planInput = await loadItemsPlanInput(rest.items, existing.salesOrderId);
    const parsed = buildItemsPlan({ raw: rest.items, salesOrderId: existing.salesOrderId, ...planInput });
    if (!parsed.ok) {
      throw parsed.status === 404
        ? new DomainNotFoundError(parsed.message)
        : new DomainValidationError(parsed.message);
    }
    parsedItemRows = parsed.data;
    progress = parsed.progress;
  }

  // ---- 状态转移 Gate（D-FPO3-H = H4：scope 已通过，此处仅判定「该转换是否合法」）----
  // 仅在显式传入 status 时执行；同状态为幂等 no-op（不阻塞纯字段更新）。
  if (rest.status !== undefined) {
    // 「生效 progress」口径与下方 data.progress 赋值完全一致：显式入参 > 明细汇总 > 保持原值
    const effectiveProgress =
      rest.progress !== undefined ? rest.progress : progress !== null ? progress : existing.progress;
    const gate = checkProductionStatusTransition(existing.status, rest.status, effectiveProgress);
    if (!gate.ok) throw new DomainConflictError(gate.message);
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
  // D-C4-B（Option B，UPDATE）：改派负责人必须通过数据范围校验，且**先于任何写入**。
  // ProductionOrder **无公海语义**，故 `null`（含 '' → 原 disconnect 语义）一律拒绝，不得借 disconnect 放行。
  if (rest.ownerId !== undefined) {
    if (rest.ownerId === null || rest.ownerId === '') {
      throw new DomainValidationError('生产负责人不存在或无权限指派');
    }
    await assertAssignableOwner(rest.ownerId, ctx);
    // ProductionOrderUpdateInput 不暴露 ownerId 标量（该字段带 User relation），必须走 relation
    data.owner = { connect: { id: rest.ownerId } };
  }
  if (rest.workshop !== undefined) data.workshop = rest.workshop;
  if (rest.requirement !== undefined) data.requirement = rest.requirement;
  if (rest.remark !== undefined) data.remark = rest.remark;
  if (rest.progress !== undefined) data.progress = rest.progress;
  else if (progress !== null) data.progress = progress;
  data.updatedBy = ctx.userId ?? null;

  let item;
  try {
    item = await updateProductionOrderAggregate({
      id: existing.id,
      itemRows: parsedItemRows,
      data,
      refConflictMessage: '生产明细已被采购单引用，无法重建明细',
      include: PRODUCTION_ORDER_INCLUDE,
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
      throw new DomainConflictError('生产明细被下游单据引用，无法重建明细');
    }
    throw e;
  }

  void activityLogger.log({
    userId: ctx.userId ?? '',
    username: ctx.username ?? '',
    realName: ctx.realName,
    action: 'UPDATE',
    module: 'fulfillment',
    businessType: BUSINESS_TYPE.PRODUCTION_ORDER,
    businessId: item.id,
    businessNo: item.productionNo,
    summary: `${ctx.username ?? ''} 更新了生产工单「${item.productionNo}」`,
    ip: ctx.ip,
    customerId: item.salesOrder?.customerId,
  });

  return item;
}

// ============================================================
// 删除
// ============================================================

export async function remove(id: string, ctx: SalesActorContext): Promise<void> {
  const existing = await productionOrderRepository.findFirst({
    where: (await scopedWhere(ctx, { id })) as Prisma.ProductionOrderWhereInput,
    select: { id: true, productionNo: true, salesOrder: { select: { customerId: true } } },
  });
  if (!existing) throw new DomainNotFoundError('生产工单不存在');

  // ProductionOrder → QualityInspection 为 Restrict，存在质检记录时数据库拒绝删除；
  // PurchaseOrder.productionOrderId 为 SetNull，明细为 Cascade（均遵守 schema，不自行改变 relation）。
  try {
    await productionOrderRepository.delete(existing.id);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
      throw new DomainConflictError('该生产工单存在质检等下游单据，无法删除');
    }
    throw e;
  }

  void activityLogger.log({
    userId: ctx.userId ?? '',
    username: ctx.username ?? '',
    realName: ctx.realName,
    action: 'DELETE',
    module: 'fulfillment',
    businessType: BUSINESS_TYPE.PRODUCTION_ORDER,
    businessId: existing.id,
    businessNo: existing.productionNo,
    summary: `${ctx.username ?? ''} 删除了生产工单「${existing.productionNo}」`,
    ip: ctx.ip,
    customerId: existing.salesOrder?.customerId,
  });
}
