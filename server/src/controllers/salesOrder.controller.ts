import { Response } from 'express';
import { z } from 'zod';
import { Currency, Prisma, SalesOrderStatus } from '@prisma/client';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';
import { applyScope, roleScope } from '../utils/scope';
import { activityLogger } from '../lib/activity-logger';
import { BUSINESS_TYPE } from '../lib/business-type';
import { getNextNumber } from '../lib/numberSequence';
import {
  BASE_CURRENCY,
  DECIMAL_PRECISION,
  normalizeRate,
  round,
  toCny,
  toDecimal,
} from '../utils/currency';

// ============================================================
// 销售订单领域（V1.0）
//
// 履约链：Opportunity → Quotation / SampleOrder → SalesOrder → ProductionOrder → Shipment
//  - SalesOrder 是唯一的正式销售订单实体，**不得**回退到 Order(type=ORDER)；
//  - 明细一律落 SalesOrderItem（结构化），**不得**使用 JSON items / 旧 OrderItem；
//  - 产品来源恒为 V1.0 Product，**不得**使用 SingleProduct / LeadProduct；
//  - 销售状态机使用 SalesOrderStatus，**不得**沿用旧 Order.status 字符串 / 旧 stage 列。
//
// 已 Deferred（不在本轮）：
//  - orderNo 走 NumberSequence runtime（当前沿用 Round 3B-2-2 已接受的「按日最大序号 +1」做法）
//  - 审批流转（全局 approval.controller 仍为 legacy，属独立 slice）
//  - customerSnapshot / termsSnapshot（ADR-04）形状未定，无消费方，暂不写入
//  - ProductionOrder / Shipment / Payment / Profit 业务逻辑（仅详情只读 include）
//  - balanceAmount / depositAmount / depositRatio 的自动推导（仅接受显式入参）
//  - paidAmountCny 由 Payment(status=CONFIRMED) 汇总回写，本 controller 不写
// ============================================================

/** 列表统一 include：客户、商机、报价、打样单、明细 */
const SALES_ORDER_INCLUDE: Prisma.SalesOrderInclude = {
  customer: { select: { id: true, customerNo: true, companyName: true } },
  opportunity: { select: { id: true, opportunityNo: true, title: true } },
  quotation: { select: { id: true, quotationNo: true, title: true } },
  sampleOrder: { select: { id: true, sampleNo: true, productName: true } },
  items: { orderBy: { lineNo: 'asc' } },
};

/** 详情额外只读 include 下游单据（本轮不实现其业务逻辑） */
const SALES_ORDER_DETAIL_INCLUDE: Prisma.SalesOrderInclude = {
  ...SALES_ORDER_INCLUDE,
  productionOrders: { select: { id: true, productionNo: true, status: true } },
  shipments: { select: { id: true, shipmentNo: true, status: true } },
  payments: {
    select: { id: true, paymentNo: true, direction: true, type: true, amount: true, currency: true, status: true },
  },
  profit: { select: { id: true, profitNo: true, profitCny: true, status: true } },
};

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

/** 金额入参：JSON number 或 string，一律经 Decimal 归一，禁止 JS number 参与运算 */
const amountSchema = z.union([z.number(), z.string()]);
type AmountInput = number | string;

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

export type SalesOrderItemInput = z.infer<typeof itemSchema>;

const createSchema = z.object({
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

const updateSchema = createSchema.partial().extend({
  id: z.string().min(1),
});

const listQuerySchema = z.object({
  customerId: z.string().optional(),
  opportunityId: z.string().optional(),
  quotationId: z.string().optional(),
  sampleOrderId: z.string().optional(),
  status: z.nativeEnum(SalesOrderStatus).optional(),
  // 按产品过滤（additive）：命中 SalesOrderItem.productId；不改变 scope / 分页 / 排序
  productId: z.string().optional(),
  keyword: z.string().optional(),
  page: z.union([z.string(), z.number()]).optional(),
  pageSize: z.union([z.string(), z.number()]).optional(),
});

/**
 * 解析汇率（冻结语义 rateToCny：1 单位原币 = X CNY）。
 *  - 本位币 CNY：恒为 1（定义性汇率，非伪造）
 *  - 其余币种：入参优先，其次取 DailyExchangeRate 最近一期
 *  - 都取不到：返回 null —— 不猜测、不按 1 兜底
 */
async function resolveExchangeRate(
  currency: Currency,
  input?: AmountInput | null,
): Promise<Prisma.Decimal | null> {
  if (currency === BASE_CURRENCY) return new Prisma.Decimal(1);
  const normalized = normalizeRate(input ?? null, 'rateToCny');
  if (normalized) return normalized;
  const latest = await prisma.dailyExchangeRate.findFirst({
    where: { currencyCode: currency },
    orderBy: { date: 'desc' },
    select: { rateToCny: true },
  });
  return toDecimal(latest?.rateToCny ?? null);
}

interface ParsedItemsOk {
  ok: true;
  data: Prisma.SalesOrderItemUncheckedCreateWithoutOrderInput[];
  total: Prisma.Decimal | null;
}
interface ParsedItemsFail {
  ok: false;
  message: string;
}

/**
 * 明细解析 + 产品快照（ADR-04）。
 *
 * 快照权威：调用方显式传入的快照值 > Product 当前值。
 * Product 后续改名 / 改包装不会回溯修改已落库的 SalesOrderItem。
 * Product 无 `spec` / `craft` / `size` 列，故这几项只取入参，不做推断（Schema limitation）。
 */
async function parseItems(
  raw: SalesOrderItemInput[] | undefined,
  currency: Currency,
): Promise<ParsedItemsOk | ParsedItemsFail> {
  if (!raw || raw.length === 0) return { ok: true, data: [], total: null };

  const productIds = Array.from(
    new Set(raw.map((i) => i.productId).filter((v): v is string => Boolean(v))),
  );
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, name: true, sku: true, packaging: true, material: true, colors: true },
      })
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

    // V1.0：amount = quantity × unitPrice（全程 Decimal，不引入 JS number）
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

/** 校验可选下游/上游实体并回填客户，做一致性校验（禁止静默创建不一致订单） */
type RefCheckResult =
  | { ok: true; customerId: string }
  | { ok: false; message: string };

async function resolveRefs(input: {
  opportunityId: string;
  customerId?: string | null;
  quotationId?: string | null;
  sampleOrderId?: string | null;
}): Promise<RefCheckResult> {
  const opportunity = await prisma.opportunity.findUnique({
    where: { id: input.opportunityId },
    select: { id: true, customerId: true },
  });
  if (!opportunity) return { ok: false, message: '商机不存在' };

  let quotation: { id: string; customerId: string } | null = null;
  if (input.quotationId) {
    quotation = await prisma.quotation.findUnique({
      where: { id: input.quotationId },
      select: { id: true, customerId: true },
    });
    if (!quotation) return { ok: false, message: '报价单不存在' };
  }

  let sampleOrder: { id: string; customerId: string } | null = null;
  if (input.sampleOrderId) {
    sampleOrder = await prisma.sampleOrder.findUnique({
      where: { id: input.sampleOrderId },
      select: { id: true, customerId: true },
    });
    if (!sampleOrder) return { ok: false, message: '打样单不存在' };
  }

  const customerId = input.customerId ?? opportunity.customerId ?? sampleOrder?.customerId ?? null;
  if (!customerId) return { ok: false, message: '客户不能为空' };

  if (opportunity.customerId !== customerId) {
    return { ok: false, message: '客户与商机所属客户不一致' };
  }
  if (quotation && quotation.customerId !== customerId) {
    return { ok: false, message: '客户与报价单所属客户不一致' };
  }
  if (sampleOrder && sampleOrder.customerId !== customerId) {
    return { ok: false, message: '客户与打样单所属客户不一致' };
  }

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true },
  });
  if (!customer) return { ok: false, message: '客户不存在' };

  return { ok: true, customerId };
}

/**
 * 「当前用户数据范围（ALL / DEPT / SELF）+ id」的查询条件。
 * 所有 SalesOrder 读写都必须经此条件，杜绝越权访问。
 */
async function scopedWhere(req: AuthRequest, id: string): Promise<Record<string, unknown>> {
  return applyScope({ id }, await roleScope(req, { field: 'ownerId' }));
}

/** Prisma 外键约束失败（下游单据引用）统一识别 */
function isForeignKeyError(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003';
}

function isUniqueError(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

// ============ 列表 ============
export const listSalesOrders = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query = listQuerySchema.parse(req.query);
    let where: Record<string, unknown> = {};
    if (query.customerId) where.customerId = query.customerId;
    if (query.opportunityId) where.opportunityId = query.opportunityId;
    if (query.quotationId) where.quotationId = query.quotationId;
    if (query.sampleOrderId) where.sampleOrderId = query.sampleOrderId;
    if (query.status) where.status = query.status;
    if (query.productId) where.items = { some: { productId: query.productId } };
    if (query.keyword) {
      where.OR = [
        { orderNo: { contains: query.keyword } },
        { customer: { companyName: { contains: query.keyword } } },
      ];
    }

    // 数据范围：ALL / DEPT / SELF（ownerId）；SalesOrder 不存在公海语义，不并入 publicSea
    where = applyScope(where, await roleScope(req, { field: 'ownerId' }));

    const pageNum = Math.max(1, Number(query.page) || 1);
    const pageSizeNum = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    const [list, total] = await Promise.all([
      prisma.salesOrder.findMany({
        where,
        include: SALES_ORDER_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * pageSizeNum,
        take: pageSizeNum,
      }),
      prisma.salesOrder.count({ where }),
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
export const getSalesOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const item = await prisma.salesOrder.findFirst({
      where: await scopedWhere(req, req.params.id),
      include: SALES_ORDER_DETAIL_INCLUDE,
    });
    if (!item) {
      fail(res, 404, '销售订单不存在');
      return;
    }
    success(res, item);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// ============ 新建 ============
export const createSalesOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = createSchema.parse(req.body);

    const refs = await resolveRefs(body);
    if (!refs.ok) {
      fail(res, 400, refs.message);
      return;
    }
    const customerId = refs.customerId;

    const currency = body.currency ?? Currency.USD;
    const parsed = await parseItems(body.items, currency);
    if (!parsed.ok) {
      fail(res, 400, parsed.message);
      return;
    }

    // 总金额：显式入参优先，其次取明细汇总（V1.0 SalesOrder.totalAmount NOT NULL）
    const totalAmount = round(body.totalAmount, DECIMAL_PRECISION.amount) ?? parsed.total;
    if (!totalAmount) {
      fail(res, 400, '订单金额不能为空');
      return;
    }

    const exchangeRate = await resolveExchangeRate(currency, body.exchangeRate);
    const totalAmountCny = toCny(totalAmount, exchangeRate);
    const status = body.status ?? SalesOrderStatus.DRAFT;

    // 编号分配与业务写入同事务：业务失败 → 计数一并回滚，不产生编号空洞
    const item = await prisma.$transaction(async (tx) => {
      const orderNo = await getNextNumber(tx, 'SO');

      return tx.salesOrder.create({
        data: {
          orderNo,
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
          ...(STATUS_TIME_FIELD[status]
            ? { [STATUS_TIME_FIELD[status] as string]: new Date() }
            : {}),
          ownerId: body.ownerId ?? req.userId ?? null,
          createdBy: req.userId ?? null,
          // 未检查（unchecked）标量外键：与嵌套 items 的 Unchecked 类型保持一致
          opportunityId: body.opportunityId,
          customerId,
          quotationId: body.quotationId ?? null,
          sampleOrderId: body.sampleOrderId ?? null,
          ...(parsed.data.length > 0 ? { items: { create: parsed.data } } : {}),
        },
        include: SALES_ORDER_INCLUDE,
      });
    });

    void activityLogger.log({
      userId: req.userId ?? '',
      username: req.username ?? '',
      realName: req.realName,
      action: 'CREATE',
      module: 'sales',
      businessType: BUSINESS_TYPE.SALES_ORDER,
      businessId: item.id,
      businessNo: item.orderNo,
      summary: `${req.username ?? ''} 创建了销售订单「${item.orderNo}」`,
      ip: req.ip,
      customerId,
    });

    created(res, item);
  } catch (e) {
    if (e instanceof z.ZodError) {
      fail(res, 400, e.errors.map((err) => err.message).join(', '));
      return;
    }
    if (isUniqueError(e)) {
      fail(res, 409, '订单号冲突，请重试');
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// ============ 更新（局部更新；明细整表重建） ============
export const updateSalesOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id, ...rest } = updateSchema.parse({ id: req.params.id, ...req.body });

    const existing = await prisma.salesOrder.findFirst({
      where: await scopedWhere(req, id),
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
    if (!existing) {
      fail(res, 404, '销售订单不存在');
      return;
    }

    // 上下游关系变更时，重新做一致性校验（客户 / 商机 / 报价 / 打样单）
    const nextOpportunityId = rest.opportunityId ?? existing.opportunityId;
    const nextQuotationId =
      rest.quotationId !== undefined ? rest.quotationId : existing.quotationId;
    const nextSampleOrderId =
      rest.sampleOrderId !== undefined ? rest.sampleOrderId : existing.sampleOrderId;
    const nextCustomerId = rest.customerId !== undefined ? rest.customerId : existing.customerId;

    const refs = await resolveRefs({
      opportunityId: nextOpportunityId,
      customerId: nextCustomerId,
      quotationId: nextQuotationId ?? null,
      sampleOrderId: nextSampleOrderId ?? null,
    });
    if (!refs.ok) {
      fail(res, 400, refs.message);
      return;
    }

    const currency = rest.currency ?? existing.currency;
    const data: Prisma.SalesOrderUpdateInput = {};
    let totalAmount: Prisma.Decimal | null = null;

    if (rest.items !== undefined) {
      const parsed = await parseItems(rest.items, currency);
      if (!parsed.ok) {
        fail(res, 400, parsed.message);
        return;
      }
      // 明细整表重建（deleteMany + create），保证与入参完全一致
      data.items = { deleteMany: {}, create: parsed.data };
      totalAmount =
        round(rest.totalAmount, DECIMAL_PRECISION.amount) ??
        parsed.total ??
        toDecimal(existing.totalAmount);
    } else if (rest.totalAmount !== undefined) {
      totalAmount = round(rest.totalAmount, DECIMAL_PRECISION.amount);
    }

    if (rest.customerId !== undefined) data.customer = { connect: { id: refs.customerId } };
    if (rest.opportunityId !== undefined) data.opportunity = { connect: { id: rest.opportunityId } };
    if (rest.quotationId !== undefined) {
      data.quotation = rest.quotationId ? { connect: { id: rest.quotationId } } : { disconnect: true };
    }
    if (rest.sampleOrderId !== undefined) {
      data.sampleOrder = rest.sampleOrderId
        ? { connect: { id: rest.sampleOrderId } }
        : { disconnect: true };
    }
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
    if (rest.ownerId !== undefined) {
      // SalesOrderUpdateInput 不暴露 ownerId 标量（该字段带 User relation），必须走 relation
      data.owner = rest.ownerId ? { connect: { id: rest.ownerId } } : { disconnect: true };
    }
    data.updatedBy = req.userId ?? null;

    // 币种 / 汇率 / 金额任一变化时，按 rateToCny 重算三件套（缺失汇率 → 置 null，不伪造）
    if (totalAmount || rest.currency !== undefined || rest.exchangeRate !== undefined) {
      if (totalAmount) data.totalAmount = totalAmount;
      const exchangeRate = await resolveExchangeRate(currency, rest.exchangeRate);
      data.exchangeRate = exchangeRate;
      data.totalAmountCny = toCny(totalAmount ?? existing.totalAmount, exchangeRate);
    }

    const item = await prisma.salesOrder.update({
      where: { id },
      data,
      include: SALES_ORDER_INCLUDE,
    });

    void activityLogger.log({
      userId: req.userId ?? '',
      username: req.username ?? '',
      realName: req.realName,
      action: 'UPDATE',
      module: 'sales',
      businessType: BUSINESS_TYPE.SALES_ORDER,
      businessId: item.id,
      businessNo: item.orderNo,
      summary: `${req.username ?? ''} 更新了销售订单「${item.orderNo}」`,
      ip: req.ip,
      customerId: item.customerId,
    });

    success(res, item, '更新成功');
  } catch (e) {
    if (e instanceof z.ZodError) {
      fail(res, 400, e.errors.map((err) => err.message).join(', '));
      return;
    }
    if (isForeignKeyError(e)) {
      fail(res, 409, '订单明细已被出运单等下游单据引用，无法重建明细');
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// ============ 删除 ============
export const removeSalesOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const existing = await prisma.salesOrder.findFirst({
      where: await scopedWhere(req, req.params.id),
      select: { id: true, orderNo: true, customerId: true },
    });
    if (!existing) {
      fail(res, 404, '销售订单不存在');
      return;
    }

    // SalesOrder → ProductionOrder / Shipment / Payment / Profit / PurchaseOrder 均为 Restrict，
    // 存在下游业务时数据库拒绝删除（不自行改变 relation）。
    await prisma.salesOrder.delete({ where: { id: existing.id } });

    void activityLogger.log({
      userId: req.userId ?? '',
      username: req.username ?? '',
      realName: req.realName,
      action: 'DELETE',
      module: 'sales',
      businessType: BUSINESS_TYPE.SALES_ORDER,
      businessId: existing.id,
      businessNo: existing.orderNo,
      summary: `${req.username ?? ''} 删除了销售订单「${existing.orderNo}」`,
      ip: req.ip,
      customerId: existing.customerId,
    });

    success(res, null, '删除成功');
  } catch (e) {
    if (isForeignKeyError(e)) {
      fail(res, 409, '该订单存在下游单据（生产 / 出运 / 收付款 / 利润 / 采购），无法删除');
      return;
    }
    fail(res, 500, '服务器错误');
  }
};
