import { Currency, PaymentDirection, PaymentStatus, PaymentType, Prisma } from '@prisma/client';
import { z } from 'zod';
import { activityLogger } from '../lib/activity-logger';
import { BUSINESS_TYPE } from '../lib/business-type';
import { DomainConflictError, DomainNotFoundError, DomainValidationError } from '../lib/errors';
import {
  createPaymentAggregate,
  removePaymentAggregate,
  updatePaymentAggregate,
} from '../operations/finance.operations';
import { paymentRepository, purchaseOrderRepository, salesOrderRepository } from '../repositories';
import { DECIMAL_PRECISION, round, toCny, toDecimal } from '../utils/currency';
import { applyScope } from '../scope';
import type { FinanceActorContext } from './finance.shared';
import { resolveExchangeRate, type AmountInput } from './salesProcess.shared';

/**
 * Payment Business Layer —— Round R-5 · Phase 4 · D2 财务域
 *
 * Payment 是独立实体，宿主 **exactly-one**：SalesOrder（收款 IN）或 PurchaseOrder（付款 OUT）。
 *   · DB 侧已有 `payment_exactly_one_owner_ck`（baseline migration），本轮不新增 CHECK；
 *   · 应用层必须再次强制：exactly-one owner + direction↔owner 一致 + 客户一致；
 *   · 宿主解析必须施加数据范围，否则任意登录用户可凭 id 把 Payment 挂到他人宿主上
 *     （IN 还会连带对他人 SalesOrder 写入 paidAmountCny）；不可见与不存在同结果，不泄露宿主存在性。
 *
 * 【paidAmountCny 权威（P0）】由 Operation 层「重算 + 整值覆写」维护，本层不直接写该字段。
 *
 * 约束：不读 req / res、不出现 `$transaction`、不直接 import Prisma 单例。
 */

// ============================================================
// DTO
// ============================================================

const amountSchema = z.union([z.number(), z.string()]);

export const paymentCreateSchema = z.object({
  direction: z.nativeEnum(PaymentDirection),
  type: z.nativeEnum(PaymentType).optional(),
  salesOrderId: z.string().optional().nullable(),
  purchaseOrderId: z.string().optional().nullable(),
  customerId: z.string().optional().nullable(),
  currency: z.nativeEnum(Currency).optional(),
  exchangeRate: amountSchema.optional().nullable(),
  amount: amountSchema,
  ratio: amountSchema.optional().nullable(),
  payDate: z.string().optional().nullable(),
  method: z.string().optional().nullable(),
  bankAccount: z.string().optional().nullable(),
  voucherRemark: z.string().optional().nullable(),
  status: z.nativeEnum(PaymentStatus).optional(),
  remark: z.string().optional().nullable(),
});

export const paymentUpdateSchema = paymentCreateSchema.partial().extend({
  id: z.string().min(1),
});

export const paymentListQuerySchema = z.object({
  direction: z.nativeEnum(PaymentDirection).optional(),
  type: z.nativeEnum(PaymentType).optional(),
  status: z.nativeEnum(PaymentStatus).optional(),
  salesOrderId: z.string().optional(),
  purchaseOrderId: z.string().optional(),
  customerId: z.string().optional(),
  keyword: z.string().optional(),
  page: z.union([z.string(), z.number()]).optional(),
  pageSize: z.union([z.string(), z.number()]).optional(),
});

export type PaymentCreateInput = z.infer<typeof paymentCreateSchema>;
export type PaymentUpdateInput = Omit<z.infer<typeof paymentUpdateSchema>, 'id'>;
export type PaymentListQuery = z.infer<typeof paymentListQuerySchema>;

/** 列表 / 详情统一 include：双宿主 + 辅助客户 */
const PAYMENT_INCLUDE = {
  salesOrder: { select: { id: true, orderNo: true, status: true, ownerId: true } },
  purchaseOrder: { select: { id: true, purchaseNo: true, status: true, ownerId: true } },
  customer: { select: { id: true, customerNo: true, companyName: true } },
} satisfies Prisma.PaymentInclude;

type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof PAYMENT_INCLUDE }>;

// ============================================================
// 宿主解析（exactly-one + direction 一致 + 客户一致 + Scope）
// ============================================================

interface ResolvedOwner {
  salesOrderId: string | null;
  purchaseOrderId: string | null;
  customerId: string | null;
}

async function resolveOwner(
  input: {
    direction: PaymentDirection;
    salesOrderId?: string | null;
    purchaseOrderId?: string | null;
    customerId?: string | null;
  },
  ctx: FinanceActorContext,
): Promise<ResolvedOwner> {
  const salesOrderId = input.salesOrderId ?? null;
  const purchaseOrderId = input.purchaseOrderId ?? null;

  if (input.direction === PaymentDirection.IN) {
    if (purchaseOrderId) throw new DomainValidationError('收款（IN）不得关联采购单');
    if (!salesOrderId) throw new DomainValidationError('收款（IN）必须关联销售订单');

    // F-3C4-01：宿主 SalesOrder 必须在本用户数据范围内
    const salesOrder = await salesOrderRepository.findFirst({
      where: applyScope({ id: salesOrderId }, await ctx.scope.owner()) as Prisma.SalesOrderWhereInput,
      select: { id: true, customerId: true },
    });
    if (!salesOrder) throw new DomainNotFoundError('销售订单不存在');
    if (input.customerId && input.customerId !== salesOrder.customerId) {
      throw new DomainValidationError('客户与销售订单所属客户不一致');
    }
    return { salesOrderId: salesOrder.id, purchaseOrderId: null, customerId: salesOrder.customerId };
  }

  // direction === OUT
  if (salesOrderId) throw new DomainValidationError('付款（OUT）不得关联销售订单');
  if (!purchaseOrderId) throw new DomainValidationError('付款（OUT）必须关联采购单');
  if (input.customerId) throw new DomainValidationError('付款（OUT）不得写入客户');

  const purchaseOrder = await purchaseOrderRepository.findFirst({
    where: applyScope({ id: purchaseOrderId }, await ctx.scope.owner()) as Prisma.PurchaseOrderWhereInput,
    select: { id: true },
  });
  if (!purchaseOrder) throw new DomainNotFoundError('采购单不存在');
  return { salesOrderId: null, purchaseOrderId: purchaseOrder.id, customerId: null };
}

/**
 * 数据范围（ALL / DEPT / SELF）。Payment 无 ownerId → 归属经宿主继承，且支持双宿主：
 *   OR [ { salesOrder: { ownerId } }, { purchaseOrder: { ownerId } } ]
 */
async function scopedWhere(
  ctx: FinanceActorContext,
  base: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const salesOrderScope = await ctx.scope.salesOrderOwner();
  const purchaseOrderScope = await ctx.scope.purchaseOrderOwner();
  if (Object.keys(salesOrderScope).length === 0 && Object.keys(purchaseOrderScope).length === 0) {
    return base;
  }
  return applyScope(base, { OR: [salesOrderScope, purchaseOrderScope] });
}

/**
 * DB 约束冲突 → 业务错误（既有映射口径逐字保留）：
 *   unique(P2002) → 409 uniqueMessage · fk(P2003) → 409 下游引用 · check(P2004 / CK 名) → 400
 */
function toDomainDbError(e: unknown, uniqueMessage: string): Error | null {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2002') return new DomainConflictError(uniqueMessage);
    if (e.code === 'P2003') return new DomainConflictError('存在下游引用，操作被拒绝');
    if (e.code === 'P2004') {
      return new DomainValidationError('宿主归属校验失败：必须且只能关联销售订单或采购单之一');
    }
  }
  if (e instanceof Error && e.message.includes('payment_exactly_one_owner_ck')) {
    return new DomainValidationError('宿主归属校验失败：必须且只能关联销售订单或采购单之一');
  }
  return null;
}

// ============================================================
// 列表 / 详情
// ============================================================

export async function list(query: PaymentListQuery, ctx: FinanceActorContext) {
  const base: Record<string, unknown> = {};
  if (query.direction) base.direction = query.direction;
  if (query.type) base.type = query.type;
  if (query.status) base.status = query.status;
  if (query.salesOrderId) base.salesOrderId = query.salesOrderId;
  if (query.purchaseOrderId) base.purchaseOrderId = query.purchaseOrderId;
  if (query.customerId) base.customerId = query.customerId;
  if (query.keyword) {
    base.OR = [
      { paymentNo: { contains: query.keyword } },
      { salesOrder: { orderNo: { contains: query.keyword } } },
      { purchaseOrder: { purchaseNo: { contains: query.keyword } } },
    ];
  }

  const where = (await scopedWhere(ctx, base)) as Prisma.PaymentWhereInput;
  const pageNum = Math.max(1, Number(query.page) || 1);
  const pageSizeNum = Math.min(100, Math.max(1, Number(query.pageSize) || 20));

  const [list, total] = await Promise.all([
    paymentRepository.findMany({
      where,
      include: PAYMENT_INCLUDE,
      orderBy: { createdAt: 'desc' },
      skip: (pageNum - 1) * pageSizeNum,
      take: pageSizeNum,
    }),
    paymentRepository.count(where),
  ]);
  return { list, total, page: pageNum, pageSize: pageSizeNum };
}

export async function getOne(id: string, ctx: FinanceActorContext): Promise<PaymentRow> {
  const item = await paymentRepository.findFirst({
    where: (await scopedWhere(ctx, { id })) as Prisma.PaymentWhereInput,
    include: PAYMENT_INCLUDE,
  });
  if (!item) throw new DomainNotFoundError('收付款单不存在');
  return item;
}

// ============================================================
// 新建 / 更新 / 删除
// ============================================================

export async function create(body: PaymentCreateInput, ctx: FinanceActorContext): Promise<PaymentRow> {
  const owner = await resolveOwner(body, ctx);

  const amount = round(body.amount, DECIMAL_PRECISION.amount);
  if (!amount || amount.lt(0)) throw new DomainValidationError('金额不合法');

  const currency = body.currency ?? Currency.USD;
  const exchangeRate = await resolveExchangeRate(currency, body.exchangeRate);
  const amountCny = toCny(amount, exchangeRate);
  const status = body.status ?? PaymentStatus.PENDING;

  let item: PaymentRow;
  try {
    item = await createPaymentAggregate(
      {
        direction: body.direction,
        type: body.type ?? PaymentType.OTHER,
        salesOrderId: owner.salesOrderId,
        purchaseOrderId: owner.purchaseOrderId,
        customerId: owner.customerId,
        currency,
        exchangeRate,
        amount,
        amountCny,
        ratio: round(body.ratio ?? null, DECIMAL_PRECISION.ratio),
        payDate: body.payDate ? new Date(body.payDate) : null,
        method: body.method ?? null,
        bankAccount: body.bankAccount ?? null,
        voucherRemark: body.voucherRemark ?? null,
        status,
        ...(status === PaymentStatus.CONFIRMED
          ? { confirmedAt: new Date(), confirmedBy: ctx.userId ?? null }
          : {}),
        remark: body.remark ?? null,
        createdBy: ctx.userId ?? null,
      },
      PAYMENT_INCLUDE,
    );
  } catch (e) {
    const mapped = toDomainDbError(e, '收付款单号冲突，请重试');
    throw mapped ?? e;
  }

  void activityLogger.log({
    userId: ctx.userId ?? '',
    username: ctx.username ?? '',
    realName: ctx.realName,
    action: 'CREATE',
    module: 'fulfillment',
    businessType: BUSINESS_TYPE.PAYMENT,
    businessId: item.id,
    businessNo: item.paymentNo,
    summary: `${ctx.username ?? ''} 创建了${item.direction === PaymentDirection.IN ? '收款' : '付款'}单「${item.paymentNo}」`,
    ip: ctx.ip,
    // 仅收款（IN）写客户时间线；付款（OUT）为客户无关的供应商付款
    ...(item.customerId ? { customerId: item.customerId } : {}),
  });

  return item;
}

export async function update(id: string, rest: PaymentUpdateInput, ctx: FinanceActorContext): Promise<PaymentRow> {
  const existing = await paymentRepository.findFirst({
    where: (await scopedWhere(ctx, { id })) as Prisma.PaymentWhereInput,
    select: {
      id: true,
      paymentNo: true,
      direction: true,
      salesOrderId: true,
      purchaseOrderId: true,
      customerId: true,
      currency: true,
      exchangeRate: true,
      amount: true,
      status: true,
    },
  });
  if (!existing) throw new DomainNotFoundError('收付款单不存在');

  // 合并后的最终 owner 组合 → 重新完整校验（exactly-one + direction 一致 + 客户一致）
  const nextDirection = rest.direction ?? existing.direction;
  const owner = await resolveOwner(
    {
      direction: nextDirection,
      salesOrderId: rest.salesOrderId !== undefined ? rest.salesOrderId : existing.salesOrderId,
      purchaseOrderId:
        rest.purchaseOrderId !== undefined ? rest.purchaseOrderId : existing.purchaseOrderId,
      customerId: rest.customerId !== undefined ? rest.customerId : existing.customerId,
    },
    ctx,
  );

  const currency = rest.currency ?? existing.currency;
  const amount =
    rest.amount !== undefined
      ? round(rest.amount, DECIMAL_PRECISION.amount)
      : toDecimal(existing.amount);
  if (!amount || amount.lt(0)) throw new DomainValidationError('金额不合法');

  // 币种变化时必须重新取汇（旧汇率已失效）；汇率显式传入优先
  let exchangeRate: Prisma.Decimal | null;
  if (rest.exchangeRate !== undefined) {
    exchangeRate = await resolveExchangeRate(currency, rest.exchangeRate);
  } else if (rest.currency !== undefined) {
    exchangeRate = await resolveExchangeRate(currency, null);
  } else {
    exchangeRate = toDecimal(existing.exchangeRate);
  }
  const amountCny = toCny(amount, exchangeRate);

  const status = rest.status ?? existing.status;
  const data: Prisma.PaymentUncheckedUpdateInput = {
    direction: nextDirection,
    salesOrderId: owner.salesOrderId,
    purchaseOrderId: owner.purchaseOrderId,
    customerId: owner.customerId,
    currency,
    exchangeRate,
    amount,
    amountCny,
    status,
    updatedBy: ctx.userId ?? null,
  };
  if (rest.type !== undefined) data.type = rest.type;
  if (rest.ratio !== undefined) data.ratio = round(rest.ratio, DECIMAL_PRECISION.ratio);
  if (rest.payDate !== undefined) data.payDate = rest.payDate ? new Date(rest.payDate) : null;
  if (rest.method !== undefined) data.method = rest.method;
  if (rest.bankAccount !== undefined) data.bankAccount = rest.bankAccount;
  if (rest.voucherRemark !== undefined) data.voucherRemark = rest.voucherRemark;
  if (rest.remark !== undefined) data.remark = rest.remark;
  if (rest.status !== undefined) {
    if (status === PaymentStatus.CONFIRMED) {
      data.confirmedAt = new Date();
      data.confirmedBy = ctx.userId ?? null;
    } else if (existing.status === PaymentStatus.CONFIRMED) {
      // 由已确认回退 → 清理确认留痕，避免与 status 语义不一致
      data.confirmedAt = null;
      data.confirmedBy = null;
    }
  }

  let item: PaymentRow;
  try {
    item = await updatePaymentAggregate({
      id: existing.id,
      data,
      include: PAYMENT_INCLUDE,
      previousSalesOrderId: existing.salesOrderId,
      nextSalesOrderId: owner.salesOrderId,
    });
  } catch (e) {
    const mapped = toDomainDbError(e, '收付款单号冲突，请重试');
    throw mapped ?? e;
  }

  void activityLogger.log({
    userId: ctx.userId ?? '',
    username: ctx.username ?? '',
    realName: ctx.realName,
    action: 'UPDATE',
    module: 'fulfillment',
    businessType: BUSINESS_TYPE.PAYMENT,
    businessId: item.id,
    businessNo: item.paymentNo,
    summary: `${ctx.username ?? ''} 更新了收付款单「${item.paymentNo}」`,
    ip: ctx.ip,
    ...(item.customerId ? { customerId: item.customerId } : {}),
  });

  return item;
}

export async function remove(id: string, ctx: FinanceActorContext): Promise<void> {
  const existing = await paymentRepository.findFirst({
    where: (await scopedWhere(ctx, { id })) as Prisma.PaymentWhereInput,
    select: { id: true, paymentNo: true, salesOrderId: true, customerId: true },
  });
  if (!existing) throw new DomainNotFoundError('收付款单不存在');

  try {
    await removePaymentAggregate({ id: existing.id, salesOrderId: existing.salesOrderId });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
      throw new DomainConflictError('该收付款单存在下游引用，无法删除');
    }
    throw e;
  }

  void activityLogger.log({
    userId: ctx.userId ?? '',
    username: ctx.username ?? '',
    realName: ctx.realName,
    action: 'DELETE',
    module: 'fulfillment',
    businessType: BUSINESS_TYPE.PAYMENT,
    businessId: existing.id,
    businessNo: existing.paymentNo,
    summary: `${ctx.username ?? ''} 删除了收付款单「${existing.paymentNo}」`,
    ip: ctx.ip,
    ...(existing.customerId ? { customerId: existing.customerId } : {}),
  });
}

export type { PaymentRow };
export type PaymentAmountInput = AmountInput;
