import { Currency, Prisma, QuotationStatus } from '@prisma/client';
import { z } from 'zod';
import { activityLogger } from '../lib/activity-logger';
import { BUSINESS_TYPE } from '../lib/business-type';
import { DomainNotFoundError, DomainValidationError } from '../lib/errors';
import { createQuotationAggregate } from '../operations/sales.operations';
import { opportunityRepository, quotationRepository } from '../repositories';
import { DECIMAL_PRECISION, round, toCny, toDecimal } from '../utils/currency';
import { applyScope } from '../scope';
import {
  assertAssignableOwner,
  resolveExchangeRate,
  salesScopedWhere,
  type AmountInput,
  type SalesActorContext,
} from './salesProcess.shared';

/**
 * Quotation Business Layer（Round R-5 · Phase 1 · Sales Process Domain）
 *
 * 职责：报价业务规则、金额三件套口径、状态时间戳联动、明细快照（ADR-04）、
 * 数据范围决策、审计留痕。
 *
 * 【Sales Process 冻结】Quotation 属**同一销售过程**内的业务记录：
 *   - 不新增 / 不写 `channelId` / `shopId`（渠道经 `opportunityId` 追溯 Sales Process 起点）；
 *   - `opportunityId` 必填且必须落在当前数据范围内（否则 400「商机不存在」）。
 */

// ============================================================
// DTO
// ============================================================

const amountSchema = z.union([z.number(), z.string()]);
export type QuotationItemInput = z.infer<typeof itemSchema>;

const itemSchema = z.object({
  productId: z.string().optional().nullable(),
  productName: z.string().optional(),
  productSku: z.string().optional().nullable(),
  spec: z.string().optional().nullable(),
  craft: z.string().optional().nullable(),
  size: z.string().optional().nullable(),
  packaging: z.string().optional().nullable(),
  quantity: amountSchema.optional(),
  unit: z.string().optional(),
  unitPrice: amountSchema.optional(),
  amount: amountSchema.optional(),
  costPrice: amountSchema.optional().nullable(),
  leadTime: z.number().int().optional().nullable(),
  remark: z.string().optional().nullable(),
  sort: z.number().int().optional(),
});

export const quotationCreateSchema = z.object({
  opportunityId: z.string().min(1, '商机不能为空'),
  customerId: z.string().optional().nullable(),
  title: z.string().min(1, '报价标题不能为空'),
  currency: z.nativeEnum(Currency).optional(),
  exchangeRate: amountSchema.optional().nullable(),
  totalAmount: amountSchema.optional(),
  validUntil: z.string().optional().nullable(),
  status: z.nativeEnum(QuotationStatus).optional(),
  tradeTerms: z.string().optional().nullable(),
  paymentTerms: z.string().optional().nullable(),
  leadTime: z.number().int().optional().nullable(),
  portOfLoading: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  ownerId: z.string().optional().nullable(),
  items: z.array(itemSchema).optional(),
});

export const quotationUpdateSchema = quotationCreateSchema.partial().extend({
  id: z.string().min(1),
});

export type QuotationCreateInput = z.infer<typeof quotationCreateSchema>;
export type QuotationUpdateInput = z.infer<typeof quotationUpdateSchema>;

/** 列表 / 详情统一 include：客户、商机、明细（含产品） */
const QUOTATION_INCLUDE = {
  customer: { select: { id: true, customerNo: true, companyName: true } },
  opportunity: { select: { id: true, opportunityNo: true, title: true } },
  items: {
    include: {
      product: {
        select: {
          id: true,
          name: true,
          sku: true,
          visibility: true,
          createdBy: true,
          visibleUsers: { select: { userId: true } },
        },
      },
    },
    orderBy: { sort: 'asc' as const },
  },
} satisfies Prisma.QuotationInclude;

export { QUOTATION_INCLUDE };

type QuotationRow = Prisma.QuotationGetPayload<{ include: typeof QUOTATION_INCLUDE }>;

/** 报价状态 → 状态时间戳字段（V1.0 状态机） */
const STATUS_TIME_FIELD: Partial<
  Record<QuotationStatus, 'submittedAt' | 'sentAt' | 'acceptedAt' | 'rejectedAt'>
> = {
  SUBMITTED: 'submittedAt',
  SENT: 'sentAt',
  ACCEPTED: 'acceptedAt',
  REJECTED: 'rejectedAt',
};

// ============================================================
// 明细解析 + 产品快照（ADR-04）
// ============================================================

interface ParsedItemsOk {
  ok: true;
  data: Prisma.QuotationItemUncheckedCreateWithoutQuotationInput[];
  total: Prisma.Decimal | null;
}
interface ParsedItemsFail {
  ok: false;
  message: string;
}

async function parseItems(
  raw: QuotationItemInput[] | undefined,
  currency: Currency,
  ctx: SalesActorContext,
): Promise<ParsedItemsOk | ParsedItemsFail> {
  if (!raw || raw.length === 0) return { ok: true, data: [], total: null };

  const productIds = Array.from(
    new Set(raw.map((i) => i.productId).filter((v): v is string => Boolean(v))),
  );
  const products = productIds.length
    ? await quotationRepository.findVisibleProducts(
        productIds,
        ctx.scope.productVisibility() as Prisma.ProductWhereInput,
      )
    : [];
  const productById = new Map(products.map((p) => [p.id, p]));

  const data: Prisma.QuotationItemUncheckedCreateWithoutQuotationInput[] = [];
  let total = new Prisma.Decimal(0);

  for (const [index, item] of raw.entries()) {
    const product = item.productId ? productById.get(item.productId) : undefined;
    // 不可见与不存在**同结果**，不引入 Product existence oracle
    if (item.productId && !product) {
      return { ok: false, message: `第 ${index + 1} 条明细产品不存在` };
    }
    const productName = item.productName ?? product?.name;
    if (!productName) {
      return { ok: false, message: `第 ${index + 1} 条明细缺少产品名称` };
    }

    const quantity = round(item.quantity ?? 1, DECIMAL_PRECISION.quantity);
    const unitPrice = round(item.unitPrice ?? 0, DECIMAL_PRECISION.unitPrice);
    if (!quantity || !unitPrice) {
      return { ok: false, message: `第 ${index + 1} 条明细数量 / 单价不合法` };
    }

    const amount =
      round(item.amount, DECIMAL_PRECISION.amount) ??
      quantity.times(unitPrice).toDecimalPlaces(DECIMAL_PRECISION.amount, Prisma.Decimal.ROUND_HALF_UP);

    data.push({
      productId: item.productId ?? null,
      productName,
      productSku: item.productSku ?? product?.sku ?? null,
      spec: item.spec ?? null,
      craft: item.craft ?? null,
      size: item.size ?? null,
      packaging: item.packaging ?? product?.packaging ?? null,
      quantity,
      unit: item.unit ?? 'PCS',
      unitPrice,
      amount,
      currency,
      costPrice: round(item.costPrice ?? null, DECIMAL_PRECISION.unitPrice),
      leadTime: item.leadTime ?? null,
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
// 列表 / 详情
// ============================================================

export interface QuotationListFilters {
  opportunityId?: string;
  customerId?: string;
  status?: QuotationStatus;
  productId?: string;
  page?: string | number;
  pageSize?: string | number;
}

export async function listQuotations(filters: QuotationListFilters, ctx: SalesActorContext) {
  let where: Record<string, unknown> = {};
  if (filters.opportunityId) where.opportunityId = filters.opportunityId;
  if (filters.customerId) where.customerId = filters.customerId;
  if (filters.status) where.status = filters.status;
  if (filters.productId) where.items = { some: { productId: String(filters.productId) } };

  where = applyScope(where, await ctx.scope.owner());

  const pageNum = Math.max(1, Number(filters.page) || 1);
  const pageSizeNum = Math.min(100, Math.max(1, Number(filters.pageSize) || 20));
  const whereInput = where as Prisma.QuotationWhereInput;

  const [list, total] = await Promise.all([
    quotationRepository.findMany({
      where: whereInput,
      include: QUOTATION_INCLUDE,
      orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
      skip: (pageNum - 1) * pageSizeNum,
      take: pageSizeNum,
    }),
    quotationRepository.count(whereInput),
  ]);
  return { list, total, page: pageNum, pageSize: pageSizeNum };
}

export async function getQuotation(id: string, ctx: SalesActorContext): Promise<QuotationRow> {
  const item = await quotationRepository.findFirst({
    where: (await salesScopedWhere(ctx, id)) as Prisma.QuotationWhereInput,
    include: QUOTATION_INCLUDE,
  });
  if (!item) throw new DomainNotFoundError('报价不存在');
  return item;
}

// ============================================================
// 新建（同一商机自动递增版本号）
// ============================================================

export async function createQuotation(
  body: QuotationCreateInput,
  ctx: SalesActorContext,
): Promise<QuotationRow> {
  // 数据范围：商机引用必须落在当前用户 ownerId 范围内（scope 外与不存在同文案）
  const opportunity = await opportunityRepository.findFirst({
    where: applyScope(
      { id: body.opportunityId },
      await ctx.scope.owner(),
    ) as Prisma.OpportunityWhereInput,
    select: { id: true, customerId: true, title: true },
  });
  if (!opportunity) throw new DomainValidationError('商机不存在');

  const customerId = body.customerId ?? opportunity.customerId;
  if (!customerId) throw new DomainValidationError('客户不能为空');

  const currency = body.currency ?? Currency.USD;
  const parsed = await parseItems(body.items, currency, ctx);
  if (!parsed.ok) throw new DomainValidationError(parsed.message);

  const totalAmount = round(body.totalAmount, DECIMAL_PRECISION.amount) ?? parsed.total;
  if (!totalAmount) throw new DomainValidationError('报价金额不能为空');

  const exchangeRate = await resolveExchangeRate(currency, body.exchangeRate);
  const totalAmountCny = toCny(totalAmount, exchangeRate);

  const maxVersion = await quotationRepository.maxVersion(body.opportunityId);
  const version = (maxVersion ?? 0) + 1;
  const status = body.status ?? QuotationStatus.DRAFT;

  if (body.ownerId !== undefined && body.ownerId !== null) {
    await assertAssignableOwner(ctx, body.ownerId);
  }

  // 编号分配与业务写入同事务（Operation 层持有）
  const item = await createQuotationAggregate(
    {
      title: body.title,
      version,
      currency,
      exchangeRate,
      totalAmount,
      totalAmountCny,
      tradeTerms: body.tradeTerms ?? null,
      paymentTerms: body.paymentTerms ?? null,
      leadTime: body.leadTime ?? null,
      validUntil: body.validUntil ? new Date(body.validUntil) : null,
      portOfLoading: body.portOfLoading ?? null,
      status,
      ...(STATUS_TIME_FIELD[status] ? { [STATUS_TIME_FIELD[status] as string]: new Date() } : {}),
      notes: body.notes ?? null,
      ownerId: body.ownerId ?? ctx.userId ?? null,
      createdBy: ctx.userId ?? null,
      opportunityId: body.opportunityId,
      customerId,
      ...(parsed.data.length > 0 ? { items: { create: parsed.data } } : {}),
    },
    QUOTATION_INCLUDE,
  );

  await activityLogger.log({
    userId: ctx.userId ?? '',
    username: ctx.username ?? '',
    realName: ctx.realName,
    action: 'CREATE',
    module: 'quotation',
    businessType: BUSINESS_TYPE.QUOTATION,
    businessId: item.id,
    businessNo: item.quotationNo,
    summary: `${ctx.username ?? ''} 创建了报价「${item.title}」（${item.quotationNo}）`,
    ip: ctx.ip,
    customerId,
  });

  return item;
}

// ============================================================
// 更新
// ============================================================

export async function updateQuotation(
  id: string,
  body: Omit<QuotationUpdateInput, 'id'>,
  ctx: SalesActorContext,
): Promise<QuotationRow> {
  const rest = body;
  const existing = await quotationRepository.findFirst({
    where: (await salesScopedWhere(ctx, id)) as Prisma.QuotationWhereInput,
    select: {
      id: true,
      quotationNo: true,
      title: true,
      currency: true,
      totalAmount: true,
      customerId: true,
    },
  });
  if (!existing) throw new DomainNotFoundError('报价不存在');

  const currency = rest.currency ?? existing.currency;
  const data: Prisma.QuotationUncheckedUpdateInput = {};
  let totalAmount: Prisma.Decimal | null = null;

  if (rest.items !== undefined) {
    const parsed = await parseItems(rest.items, currency, ctx);
    if (!parsed.ok) throw new DomainValidationError(parsed.message);
    // 明细整表重建（deleteMany + create），保证与入参完全一致
    data.items = { deleteMany: {}, create: parsed.data };
    totalAmount =
      round(rest.totalAmount, DECIMAL_PRECISION.amount) ?? parsed.total ?? toDecimal(existing.totalAmount);
  } else if (rest.totalAmount !== undefined) {
    totalAmount = round(rest.totalAmount, DECIMAL_PRECISION.amount);
  }

  if (rest.opportunityId) {
    const opportunity = await opportunityRepository.findFirst({
      where: applyScope(
        { id: rest.opportunityId },
        await ctx.scope.owner(),
      ) as Prisma.OpportunityWhereInput,
      select: { id: true, customerId: true, title: true },
    });
    if (!opportunity) throw new DomainValidationError('商机不存在');
    data.opportunityId = rest.opportunityId;
  }
  if (rest.customerId) data.customerId = rest.customerId;
  if (rest.title !== undefined) data.title = rest.title;
  if (rest.currency !== undefined) data.currency = rest.currency;
  if (rest.validUntil !== undefined) {
    data.validUntil = rest.validUntil ? new Date(rest.validUntil) : null;
  }
  if (rest.status !== undefined) {
    data.status = rest.status;
    const timeField = STATUS_TIME_FIELD[rest.status];
    if (timeField) data[timeField] = new Date();
  }
  if (rest.notes !== undefined) data.notes = rest.notes;
  if (rest.tradeTerms !== undefined) data.tradeTerms = rest.tradeTerms;
  if (rest.paymentTerms !== undefined) data.paymentTerms = rest.paymentTerms;
  if (rest.leadTime !== undefined) data.leadTime = rest.leadTime;
  if (rest.portOfLoading !== undefined) data.portOfLoading = rest.portOfLoading;

  // 改派归属必须通过数据范围校验，且**先于任何写入**；Quotation 无公海语义，null 一律拒绝
  if (rest.ownerId !== undefined) {
    if (rest.ownerId === null || rest.ownerId === '') {
      throw new DomainValidationError('业务归属人不存在或无权限指派');
    }
    await assertAssignableOwner(ctx, rest.ownerId);
    data.ownerId = rest.ownerId;
  }
  data.updatedBy = ctx.userId ?? null;

  // 币种 / 汇率 / 金额任一变化时，按 rateToCny 重算三件套（缺失汇率 → 置 null，不伪造）
  if (totalAmount || rest.currency !== undefined || rest.exchangeRate !== undefined) {
    if (totalAmount) data.totalAmount = totalAmount;
    const exchangeRate = await resolveExchangeRate(currency, rest.exchangeRate);
    data.exchangeRate = exchangeRate;
    data.totalAmountCny = toCny(totalAmount ?? existing.totalAmount, exchangeRate);
  }

  const item = await quotationRepository.update({
    where: { id },
    data,
    include: QUOTATION_INCLUDE,
  });

  await activityLogger.log({
    userId: ctx.userId ?? '',
    username: ctx.username ?? '',
    realName: ctx.realName,
    action: 'UPDATE',
    module: 'quotation',
    businessType: BUSINESS_TYPE.QUOTATION,
    businessId: item.id,
    businessNo: item.quotationNo,
    summary: `${ctx.username ?? ''} 更新了报价「${item.title}」（${item.quotationNo}）`,
    ip: ctx.ip,
    customerId: item.customerId,
  });

  return item;
}

// ============================================================
// 删除
// ============================================================

export async function removeQuotation(id: string, ctx: SalesActorContext): Promise<void> {
  const existing = await quotationRepository.findFirst({
    where: (await salesScopedWhere(ctx, id)) as Prisma.QuotationWhereInput,
    select: { id: true, quotationNo: true, title: true, customerId: true },
  });
  if (!existing) throw new DomainNotFoundError('报价不存在');

  await quotationRepository.delete({ where: { id: existing.id } });

  await activityLogger.log({
    userId: ctx.userId ?? '',
    username: ctx.username ?? '',
    realName: ctx.realName,
    action: 'DELETE',
    module: 'quotation',
    businessType: BUSINESS_TYPE.QUOTATION,
    businessId: existing.id,
    businessNo: existing.quotationNo,
    summary: `${ctx.username ?? ''} 删除了报价「${existing.title}」（${existing.quotationNo}）`,
    ip: ctx.ip,
    customerId: existing.customerId,
  });
}

export type { AmountInput };
