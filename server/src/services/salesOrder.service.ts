import { Currency, Prisma, SalesOrderStatus } from '@prisma/client';
import { z } from 'zod';
import { activityLogger } from '../lib/activity-logger';
import { BUSINESS_TYPE } from '../lib/business-type';
import { DomainConflictError, DomainNotFoundError, DomainValidationError } from '../lib/errors';
import {
  createSalesOrderAggregate,
  removeSalesOrderAggregate,
  updateSalesOrderAggregate,
} from '../operations/sales.operations';
import {
  customerRepository,
  opportunityRepository,
  quotationRepository,
  sampleOrderRepository,
  salesOrderRepository,
} from '../repositories';
import { DECIMAL_PRECISION, round, toCny, toDecimal } from '../utils/currency';
import { applyScope } from '../utils/scope';
import { advanceLeadStatusByOpportunityOperation } from '../operations/state.operations';
import {
  assertAssignableOwner,
  resolveExchangeRate,
  salesScopedWhere,
  type SalesActorContext,
} from './salesProcess.shared';

/**
 * SalesOrder Business Layer（Round R-5 · Phase 1 · Sales Process Domain）
 *
 * 职责：订单业务规则、上下游一致性（商机 / 报价 / 打样单必须同客户）、
 * 金额三件套与快照、数据范围决策、审计留痕，以及
 * **Customer 订单统计（B5）的事件驱动触发**（回算本体在 Operation 层）。
 *
 * 【Sales Process 冻结】SalesOrder 是同一销售过程的**成交事实**：
 *   - **不新增** `channelId` / `shopId`（渠道经 `opportunityId` 追溯起点）；
 *   - `opportunityId` 必填 ⇒ 起点必然可追溯；
 *   - 订单成立 ⇒ 线索 `WON`（既有行为）；商机**不**落库独立 Win/Lost 终态（B1）。
 */

// ============================================================
// DTO
// ============================================================

const amountSchema = z.union([z.number(), z.string()]);
export type SalesOrderItemInput = z.infer<typeof itemSchema>;

const itemSchema = z.object({
  productId: z.string().optional().nullable(),
  customerProductId: z.string().optional().nullable(),
  productName: z.string().optional(),
  productSku: z.string().optional().nullable(),
  spec: z.string().optional().nullable(),
  craft: z.string().optional().nullable(),
  size: z.string().optional().nullable(),
  material: z.string().optional().nullable(),
  packaging: z.string().optional().nullable(),
  colors: z.array(z.string()).optional(),
  quantity: amountSchema.optional(),
  unit: z.string().optional(),
  unitPrice: amountSchema.optional(),
  amount: amountSchema.optional(),
  costPrice: amountSchema.optional().nullable(),
  costAmount: amountSchema.optional().nullable(),
  deliveryDate: z.string().optional().nullable(),
  remark: z.string().optional().nullable(),
  sort: z.number().int().optional(),
});

export const salesOrderCreateSchema = z.object({
  opportunityId: z.string().min(1, '商机不能为空'),
  customerId: z.string().optional().nullable(),
  quotationId: z.string().optional().nullable(),
  sampleOrderId: z.string().optional().nullable(),
  currency: z.nativeEnum(Currency).optional(),
  exchangeRate: amountSchema.optional().nullable(),
  totalAmount: amountSchema.optional(),
  depositRatio: amountSchema.optional().nullable(),
  depositAmount: amountSchema.optional().nullable(),
  balanceAmount: amountSchema.optional().nullable(),
  status: z.nativeEnum(SalesOrderStatus).optional(),
  orderDate: z.string().optional().nullable(),
  deliveryDate: z.string().optional().nullable(),
  actualDeliveryDate: z.string().optional().nullable(),
  tradeTerms: z.string().optional().nullable(),
  paymentTerms: z.string().optional().nullable(),
  portOfLoading: z.string().optional().nullable(),
  portOfDischarge: z.string().optional().nullable(),
  cancelReason: z.string().optional().nullable(),
  remark: z.string().optional().nullable(),
  ownerId: z.string().optional().nullable(),
  items: z.array(itemSchema).optional(),
});

export const salesOrderUpdateSchema = salesOrderCreateSchema.partial().extend({
  id: z.string().min(1),
});

export const salesOrderListQuerySchema = z.object({
  customerId: z.string().optional(),
  opportunityId: z.string().optional(),
  quotationId: z.string().optional(),
  sampleOrderId: z.string().optional(),
  status: z.nativeEnum(SalesOrderStatus).optional(),
  productId: z.string().optional(),
  keyword: z.string().optional(),
  page: z.union([z.string(), z.number()]).optional(),
  pageSize: z.union([z.string(), z.number()]).optional(),
});

export type SalesOrderCreateInput = z.infer<typeof salesOrderCreateSchema>;
export type SalesOrderUpdateInput = z.infer<typeof salesOrderUpdateSchema>;
export type SalesOrderListFilters = z.infer<typeof salesOrderListQuerySchema>;

/** 列表统一 include：客户、商机、报价、打样单、明细 */
export const SALES_ORDER_INCLUDE = {
  customer: { select: { id: true, customerNo: true, companyName: true } },
  opportunity: { select: { id: true, opportunityNo: true, title: true } },
  quotation: { select: { id: true, quotationNo: true, title: true } },
  sampleOrder: { select: { id: true, sampleNo: true, productName: true } },
  items: { orderBy: { lineNo: 'asc' as const } },
} satisfies Prisma.SalesOrderInclude;

/** 详情额外只读 include 下游单据（本轮不实现其业务逻辑） */
export const SALES_ORDER_DETAIL_INCLUDE = {
  ...SALES_ORDER_INCLUDE,
  productionOrders: { select: { id: true, productionNo: true, status: true } },
  shipments: { select: { id: true, shipmentNo: true, status: true } },
  payments: {
    select: {
      id: true,
      paymentNo: true,
      direction: true,
      type: true,
      amount: true,
      currency: true,
      status: true,
    },
  },
  profit: { select: { id: true, profitNo: true, profitCny: true, status: true } },
} satisfies Prisma.SalesOrderInclude;

type SalesOrderRow = Prisma.SalesOrderGetPayload<{ include: typeof SALES_ORDER_INCLUDE }>;
type SalesOrderDetailRow = Prisma.SalesOrderGetPayload<{ include: typeof SALES_ORDER_DETAIL_INCLUDE }>;

/** 销售订单状态 → 状态时间戳字段（V1.0 状态机） */
const STATUS_TIME_FIELD: Partial<
  Record<
    SalesOrderStatus,
    | 'confirmedAt'
    | 'depositPaidAt'
    | 'productionStartAt'
    | 'qcAt'
    | 'readyToShipAt'
    | 'shippedAt'
    | 'completedAt'
    | 'cancelledAt'
  >
> = {
  CONFIRMED: 'confirmedAt',
  DEPOSIT_PAID: 'depositPaidAt',
  IN_PRODUCTION: 'productionStartAt',
  QC: 'qcAt',
  READY_TO_SHIP: 'readyToShipAt',
  SHIPPED: 'shippedAt',
  COMPLETED: 'completedAt',
  CANCELLED: 'cancelledAt',
};

// ============================================================
// 明细解析 + 产品快照（ADR-04）
// ============================================================

interface ParsedItemsOk {
  ok: true;
  data: Prisma.SalesOrderItemUncheckedCreateWithoutOrderInput[];
  total: Prisma.Decimal | null;
}
interface ParsedItemsFail {
  ok: false;
  message: string;
}

async function parseItems(
  raw: SalesOrderItemInput[] | undefined,
  currency: Currency,
  ctx: SalesActorContext,
): Promise<ParsedItemsOk | ParsedItemsFail> {
  if (!raw || raw.length === 0) return { ok: true, data: [], total: null };

  const productIds = Array.from(
    new Set(raw.map((i) => i.productId).filter((v): v is string => Boolean(v))),
  );
  const products = productIds.length
    ? await salesOrderRepository.findVisibleProducts(
        productIds,
        ctx.scope.productVisibility() as Prisma.ProductWhereInput,
      )
    : [];
  const productById = new Map(products.map((p) => [p.id, p]));

  const data: Prisma.SalesOrderItemUncheckedCreateWithoutOrderInput[] = [];
  let total = new Prisma.Decimal(0);

  for (const [index, item] of raw.entries()) {
    const product = item.productId ? productById.get(item.productId) : undefined;
    if (item.productId && !product) {
      return { ok: false, message: `第 ${index + 1} 行明细产品不存在` };
    }
    const productName = item.productName ?? product?.name;
    if (!productName) {
      return { ok: false, message: `第 ${index + 1} 行明细缺少产品名称` };
    }

    const quantity = round(item.quantity ?? 1, DECIMAL_PRECISION.quantity);
    if (!quantity || quantity.lte(0)) {
      return { ok: false, message: `第 ${index + 1} 行明细数量不合法` };
    }
    const unitPrice = round(item.unitPrice ?? 0, DECIMAL_PRECISION.unitPrice);
    if (!unitPrice || unitPrice.lt(0)) {
      return { ok: false, message: `第 ${index + 1} 行明细单价不合法` };
    }

    const amount =
      round(item.amount, DECIMAL_PRECISION.amount) ??
      quantity.times(unitPrice).toDecimalPlaces(DECIMAL_PRECISION.amount, Prisma.Decimal.ROUND_HALF_UP);

    const costPrice = round(item.costPrice ?? null, DECIMAL_PRECISION.unitPrice);
    const costAmount =
      round(item.costAmount, DECIMAL_PRECISION.amount) ??
      (costPrice
        ? costPrice.times(quantity).toDecimalPlaces(DECIMAL_PRECISION.amount, Prisma.Decimal.ROUND_HALF_UP)
        : null);

    data.push({
      lineNo: index + 1,
      productId: item.productId ?? null,
      customerProductId: item.customerProductId ?? null,
      productName,
      productSku: item.productSku ?? product?.sku ?? null,
      spec: item.spec ?? null,
      craft: item.craft ?? null,
      size: item.size ?? null,
      material: item.material ?? product?.material ?? null,
      packaging: item.packaging ?? product?.packaging ?? null,
      colors: item.colors ?? product?.colors ?? [],
      quantity,
      unit: item.unit ?? 'PCS',
      unitPrice,
      amount,
      currency,
      costPrice,
      costAmount,
      deliveryDate: item.deliveryDate ? new Date(item.deliveryDate) : null,
      remark: item.remark ?? null,
      sort: item.sort ?? index,
    });

    total = total.plus(amount);
  }

  return {
    ok: true,
    data,
    total: total.toDecimalPlaces(DECIMAL_PRECISION.amount, Prisma.Decimal.ROUND_HALF_UP),
  };
}

// ============================================================
// 上下游一致性（D-C4-A Option C 口径，保持不变）
// ============================================================

async function resolveRefs(
  input: {
    opportunityId: string;
    customerId?: string | null;
    quotationId?: string | null;
    sampleOrderId?: string | null;
  },
  ctx: SalesActorContext,
): Promise<string> {
  const opportunity = await opportunityRepository.findFirst({
    where: applyScope(
      { id: input.opportunityId },
      await ctx.scope.owner(),
    ) as Prisma.OpportunityWhereInput,
    select: { id: true, customerId: true },
  });
  if (!opportunity) throw new DomainValidationError('商机不存在');

  let quotation: { id: string; customerId: string } | null = null;
  if (input.quotationId) {
    quotation = await quotationRepository.findFirst({
      where: applyScope(
        { id: input.quotationId },
        await ctx.scope.owner(),
      ) as Prisma.QuotationWhereInput,
      select: { id: true, customerId: true },
    });
    if (!quotation) throw new DomainValidationError('报价单不存在');
  }

  let sampleOrder: { id: string; customerId: string } | null = null;
  if (input.sampleOrderId) {
    sampleOrder = await sampleOrderRepository.findFirst({
      where: applyScope(
        { id: input.sampleOrderId },
        await ctx.scope.owner(),
      ) as Prisma.SampleOrderWhereInput,
      select: { id: true, customerId: true },
    });
    if (!sampleOrder) throw new DomainValidationError('打样单不存在');
  }

  const customerId = input.customerId ?? opportunity.customerId ?? sampleOrder?.customerId ?? null;
  if (!customerId) throw new DomainValidationError('客户不能为空');

  if (opportunity.customerId !== customerId) {
    throw new DomainValidationError('客户与商机所属客户不一致');
  }
  if (quotation && quotation.customerId !== customerId) {
    throw new DomainValidationError('客户与报价单所属客户不一致');
  }
  if (sampleOrder && sampleOrder.customerId !== customerId) {
    throw new DomainValidationError('客户与打样单所属客户不一致');
  }

  const customer = await customerRepository.findFirst({
    where: { id: customerId },
    select: { id: true },
  });
  if (!customer) throw new DomainValidationError('客户不存在');

  return customerId;
}

// ============================================================
// 列表 / 详情
// ============================================================

export async function listSalesOrders(filters: SalesOrderListFilters, ctx: SalesActorContext) {
  let where: Record<string, unknown> = {};
  if (filters.customerId) where.customerId = filters.customerId;
  if (filters.opportunityId) where.opportunityId = filters.opportunityId;
  if (filters.quotationId) where.quotationId = filters.quotationId;
  if (filters.sampleOrderId) where.sampleOrderId = filters.sampleOrderId;
  if (filters.status) where.status = filters.status;
  if (filters.productId) where.items = { some: { productId: filters.productId } };
  if (filters.keyword) {
    where.OR = [
      { orderNo: { contains: filters.keyword } },
      { customer: { companyName: { contains: filters.keyword } } },
    ];
  }
  where = applyScope(where, await ctx.scope.owner());

  const pageNum = Math.max(1, Number(filters.page) || 1);
  const pageSizeNum = Math.min(100, Math.max(1, Number(filters.pageSize) || 20));
  const whereInput = where as Prisma.SalesOrderWhereInput;

  const [list, total] = await Promise.all([
    salesOrderRepository.findMany({
      where: whereInput,
      include: SALES_ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
      skip: (pageNum - 1) * pageSizeNum,
      take: pageSizeNum,
    }),
    salesOrderRepository.countWhere(whereInput),
  ]);
  return { list, total, page: pageNum, pageSize: pageSizeNum };
}

export async function getSalesOrder(id: string, ctx: SalesActorContext): Promise<SalesOrderDetailRow> {
  const item = await salesOrderRepository.findFirst({
    where: (await salesScopedWhere(ctx, id)) as Prisma.SalesOrderWhereInput,
    include: SALES_ORDER_DETAIL_INCLUDE,
  });
  if (!item) throw new DomainNotFoundError('销售订单不存在');
  return item;
}

// ============================================================
// 新建
// ============================================================

export async function createSalesOrder(
  body: SalesOrderCreateInput,
  ctx: SalesActorContext,
): Promise<SalesOrderRow> {
  const customerId = await resolveRefs(body, ctx);

  if (body.ownerId !== undefined && body.ownerId !== null) {
    await assertAssignableOwner(ctx, body.ownerId);
  }

  const currency = body.currency ?? Currency.USD;
  const parsed = await parseItems(body.items, currency, ctx);
  if (!parsed.ok) throw new DomainValidationError(parsed.message);

  const totalAmount = round(body.totalAmount, DECIMAL_PRECISION.amount) ?? parsed.total;
  if (!totalAmount) throw new DomainValidationError('订单金额不能为空');

  const exchangeRate = await resolveExchangeRate(currency, body.exchangeRate);
  const totalAmountCny = toCny(totalAmount, exchangeRate);
  const status = body.status ?? SalesOrderStatus.DRAFT;

  // 编号分配 + 落库 + Customer 订单统计回算，同事务（Operation 层持有）
  const item = await createSalesOrderAggregate(
    {
      currency,
      exchangeRate,
      totalAmount,
      totalAmountCny,
      depositRatio: round(body.depositRatio ?? null, DECIMAL_PRECISION.ratio),
      depositAmount: round(body.depositAmount ?? null, DECIMAL_PRECISION.amount),
      balanceAmount: round(body.balanceAmount ?? null, DECIMAL_PRECISION.amount),
      orderDate: body.orderDate ? new Date(body.orderDate) : null,
      deliveryDate: body.deliveryDate ? new Date(body.deliveryDate) : null,
      actualDeliveryDate: body.actualDeliveryDate ? new Date(body.actualDeliveryDate) : null,
      tradeTerms: body.tradeTerms ?? null,
      paymentTerms: body.paymentTerms ?? null,
      portOfLoading: body.portOfLoading ?? null,
      portOfDischarge: body.portOfDischarge ?? null,
      cancelReason: body.cancelReason ?? null,
      remark: body.remark ?? null,
      status,
      ...(STATUS_TIME_FIELD[status] ? { [STATUS_TIME_FIELD[status] as string]: new Date() } : {}),
      ownerId: body.ownerId ?? ctx.userId ?? null,
      createdBy: ctx.userId ?? null,
      opportunityId: body.opportunityId,
      customerId,
      quotationId: body.quotationId ?? null,
      sampleOrderId: body.sampleOrderId ?? null,
      ...(parsed.data.length > 0 ? { items: { create: parsed.data } } : {}),
    },
    SALES_ORDER_INCLUDE,
  );

  await activityLogger.log({
    userId: ctx.userId ?? '',
    username: ctx.username ?? '',
    realName: ctx.realName,
    action: 'CREATE',
    module: 'sales',
    businessType: BUSINESS_TYPE.SALES_ORDER,
    businessId: item.id,
    businessNo: item.orderNo,
    summary: `${ctx.username ?? ''} 创建了销售订单「${item.orderNo}」`,
    ip: ctx.ip,
    customerId,
  });

  // 线索状态自动推进（经 Opportunity.leadId 追溯）→ 已成交
  await advanceLeadStatusByOpportunityOperation(item.opportunityId, 'WON');

  return item;
}

// ============================================================
// 更新（局部更新；明细整表重建）
// ============================================================

export async function updateSalesOrder(
  id: string,
  rest: Omit<SalesOrderUpdateInput, 'id'>,
  ctx: SalesActorContext,
): Promise<SalesOrderRow> {
  const existing = await salesOrderRepository.findFirst({
    where: (await salesScopedWhere(ctx, id)) as Prisma.SalesOrderWhereInput,
    select: {
      id: true,
      orderNo: true,
      customerId: true,
      opportunityId: true,
      quotationId: true,
      sampleOrderId: true,
      currency: true,
      totalAmount: true,
    },
  });
  if (!existing) throw new DomainNotFoundError('销售订单不存在');

  const nextOpportunityId = rest.opportunityId ?? existing.opportunityId;
  const nextQuotationId = rest.quotationId !== undefined ? rest.quotationId : existing.quotationId;
  const nextSampleOrderId =
    rest.sampleOrderId !== undefined ? rest.sampleOrderId : existing.sampleOrderId;
  const nextCustomerId = rest.customerId !== undefined ? rest.customerId : existing.customerId;

  if (rest.ownerId !== undefined) {
    if (rest.ownerId === null || rest.ownerId === '') {
      throw new DomainValidationError('业务归属人不存在或无权限指派');
    }
    await assertAssignableOwner(ctx, rest.ownerId);
  }

  const customerId = await resolveRefs(
    {
      opportunityId: nextOpportunityId,
      customerId: nextCustomerId,
      quotationId: nextQuotationId ?? null,
      sampleOrderId: nextSampleOrderId ?? null,
    },
    ctx,
  );

  const currency = rest.currency ?? existing.currency;
  const data: Prisma.SalesOrderUncheckedUpdateInput = {};
  let totalAmount: Prisma.Decimal | null = null;

  if (rest.items !== undefined) {
    const parsed = await parseItems(rest.items, currency, ctx);
    if (!parsed.ok) throw new DomainValidationError(parsed.message);
    data.items = { deleteMany: {}, create: parsed.data };
    totalAmount =
      round(rest.totalAmount, DECIMAL_PRECISION.amount) ??
      parsed.total ??
      toDecimal(existing.totalAmount);
  } else if (rest.totalAmount !== undefined) {
    totalAmount = round(rest.totalAmount, DECIMAL_PRECISION.amount);
  }

  if (rest.customerId !== undefined) data.customerId = customerId;
  if (rest.opportunityId !== undefined) data.opportunityId = rest.opportunityId;
  if (rest.quotationId !== undefined) data.quotationId = rest.quotationId ?? null;
  if (rest.sampleOrderId !== undefined) data.sampleOrderId = rest.sampleOrderId ?? null;
  if (rest.currency !== undefined) data.currency = rest.currency;
  if (rest.depositRatio !== undefined) {
    data.depositRatio = round(rest.depositRatio, DECIMAL_PRECISION.ratio);
  }
  if (rest.depositAmount !== undefined) {
    data.depositAmount = round(rest.depositAmount, DECIMAL_PRECISION.amount);
  }
  if (rest.balanceAmount !== undefined) {
    data.balanceAmount = round(rest.balanceAmount, DECIMAL_PRECISION.amount);
  }
  if (rest.orderDate !== undefined) data.orderDate = rest.orderDate ? new Date(rest.orderDate) : null;
  if (rest.deliveryDate !== undefined) {
    data.deliveryDate = rest.deliveryDate ? new Date(rest.deliveryDate) : null;
  }
  if (rest.actualDeliveryDate !== undefined) {
    data.actualDeliveryDate = rest.actualDeliveryDate ? new Date(rest.actualDeliveryDate) : null;
  }
  if (rest.tradeTerms !== undefined) data.tradeTerms = rest.tradeTerms;
  if (rest.paymentTerms !== undefined) data.paymentTerms = rest.paymentTerms;
  if (rest.portOfLoading !== undefined) data.portOfLoading = rest.portOfLoading;
  if (rest.portOfDischarge !== undefined) data.portOfDischarge = rest.portOfDischarge;
  if (rest.cancelReason !== undefined) data.cancelReason = rest.cancelReason;
  if (rest.remark !== undefined) data.remark = rest.remark;
  if (rest.status !== undefined) {
    data.status = rest.status;
    const timeField = STATUS_TIME_FIELD[rest.status];
    if (timeField) data[timeField] = new Date();
  }
  if (rest.ownerId !== undefined) data.ownerId = rest.ownerId;
  data.updatedBy = ctx.userId ?? null;

  if (totalAmount || rest.currency !== undefined || rest.exchangeRate !== undefined) {
    if (totalAmount) data.totalAmount = totalAmount;
    const exchangeRate = await resolveExchangeRate(currency, rest.exchangeRate);
    data.exchangeRate = exchangeRate;
    data.totalAmountCny = toCny(totalAmount ?? existing.totalAmount, exchangeRate);
  }

  // B5：变更前后的客户都要回算（改客户 / 改金额 / 改状态 / 改下单日 均影响统计）
  const item = await updateSalesOrderAggregate({
    id,
    data,
    include: SALES_ORDER_INCLUDE,
    replaceItems: rest.items !== undefined,
    affectedCustomerIds: [existing.customerId, customerId],
  });

  await activityLogger.log({
    userId: ctx.userId ?? '',
    username: ctx.username ?? '',
    realName: ctx.realName,
    action: 'UPDATE',
    module: 'sales',
    businessType: BUSINESS_TYPE.SALES_ORDER,
    businessId: item.id,
    businessNo: item.orderNo,
    summary: `${ctx.username ?? ''} 更新了销售订单「${item.orderNo}」`,
    ip: ctx.ip,
    customerId: item.customerId,
  });

  return item;
}

// ============================================================
// 删除
// ============================================================

export async function removeSalesOrder(id: string, ctx: SalesActorContext): Promise<void> {
  const existing = await salesOrderRepository.findFirst({
    where: (await salesScopedWhere(ctx, id)) as Prisma.SalesOrderWhereInput,
    select: { id: true, orderNo: true, customerId: true },
  });
  if (!existing) throw new DomainNotFoundError('销售订单不存在');

  // SalesOrder → ProductionOrder / Shipment / Payment / Profit / PurchaseOrder 均为 Restrict，
  // 存在下游业务时数据库拒绝删除（不自行改变 relation）。
  try {
    await removeSalesOrderAggregate({
      id: existing.id,
      affectedCustomerIds: [existing.customerId],
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
      throw new DomainConflictError(
        '该订单存在下游单据（生产 / 出运 / 收付款 / 利润 / 采购），无法删除',
      );
    }
    throw e;
  }

  await activityLogger.log({
    userId: ctx.userId ?? '',
    username: ctx.username ?? '',
    realName: ctx.realName,
    action: 'DELETE',
    module: 'sales',
    businessType: BUSINESS_TYPE.SALES_ORDER,
    businessId: existing.id,
    businessNo: existing.orderNo,
    summary: `${ctx.username ?? ''} 删除了销售订单「${existing.orderNo}」`,
    ip: ctx.ip,
    customerId: existing.customerId,
  });
}

export type { SalesOrderRow, SalesOrderDetailRow };
