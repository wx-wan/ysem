import { Response } from 'express';
import { z } from 'zod';
import { Currency, PaymentDirection, PaymentStatus, PaymentType, Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { getNextNumber } from '../lib/numberSequence';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';
import { applyScope, roleScope } from '../utils/scope';
import { activityLogger } from '../lib/activity-logger';
import { BUSINESS_TYPE } from '../lib/business-type';
import {
  BASE_CURRENCY,
  DECIMAL_PRECISION,
  normalizeRate,
  round,
  toCny,
  toDecimal,
} from '../utils/currency';

// ============================================================
// 收付款领域（V1.0）
//
// Payment 是独立实体，宿主 **exactly-one**：SalesOrder（收款 IN）或 PurchaseOrder（付款 OUT）。
//  - DB 侧已有 `payment_exactly_one_owner_ck`（baseline migration），本轮不新增 CHECK。
//  - 应用层必须再次强制：exactly-one owner + direction↔owner 一致 + 客户一致。
//  - 统一使用 V1.0 Payment（**不得**回退到旧 PaymentRecord / Order）。
//
// 【paidAmountCny 权威（P0）】
//   SalesOrder.paidAmountCny = SUM(Payment.amountCny WHERE direction=IN AND status=CONFIRMED)
//   一律「重算 + 整值覆写」，绝不使用 `paidAmountCny += amountCny` 的累加写法。
//   NULL 语义：SUM 忽略 NULL；无有效金额 → 写 0（绝不写 NULL）。
//
// 已 Deferred（不在本轮）：
//  - paymentNo 走 NumberSequence runtime（当前沿用「按日最大序号 +1」做法）
//  - 审批流转（全局 approval.controller 仍为 legacy，属独立 slice）
//  - 行级收付款分配（Payment 无 salesOrderItemId / 分配表）
//  - 旧 /api/orders/payments 与 order.controller.ts 的 legacy 逻辑（Order 五拆收尾）
// ============================================================

/** 列表 / 详情统一 include：双宿主 + 辅助客户 */
const PAYMENT_INCLUDE: Prisma.PaymentInclude = {
  salesOrder: { select: { id: true, orderNo: true, status: true, ownerId: true } },
  purchaseOrder: { select: { id: true, purchaseNo: true, status: true, ownerId: true } },
  customer: { select: { id: true, customerNo: true, companyName: true } },
};

/** 金额入参：JSON number 或 string，一律经 Decimal 归一，禁止 JS number 参与金额运算 */
const amountSchema = z.union([z.number(), z.string()]);
type AmountInput = number | string;

const createSchema = z.object({
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

const updateSchema = createSchema.partial().extend({
  id: z.string().min(1),
});

const listQuerySchema = z.object({
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

interface ResolvedOwner {
  salesOrderId: string | null;
  purchaseOrderId: string | null;
  customerId: string | null;
}

type ResolveOwnerResult =
  | { ok: true; owner: ResolvedOwner }
  | { ok: false; status: 400 | 404; message: string };

/**
 * exactly-one owner + direction↔owner 一致 + 客户一致（应用层强制）。
 *
 * IN  → salesOrderId 必填、purchaseOrderId 必须为空、customerId = SalesOrder.customerId
 * OUT → purchaseOrderId 必填、salesOrderId 必须为空、customerId 必须为空（供应商付款不得写入客户）
 *
 * 【F-3C4-01 · 宿主 Scope（DATA SCOPE）】
 * 宿主解析必须施加数据范围，否则任意登录用户可凭 id 把 Payment 挂到他人宿主上
 * （IN 还会连带对他人 SalesOrder 写入 paidAmountCny）。
 * scope 条件会注入非唯一条件，故 `findUnique` → `findFirst`。
 * 不可见与不存在返回同一结果（404 / 400 文案不变），不泄露宿主存在性。
 */
async function resolveOwner(
  req: AuthRequest,
  input: {
    direction: PaymentDirection;
    salesOrderId?: string | null;
    purchaseOrderId?: string | null;
    customerId?: string | null;
  },
): Promise<ResolveOwnerResult> {
  const salesOrderId = input.salesOrderId ?? null;
  const purchaseOrderId = input.purchaseOrderId ?? null;

  if (input.direction === PaymentDirection.IN) {
    if (purchaseOrderId) {
      return { ok: false, status: 400, message: '收款（IN）不得关联采购单' };
    }
    if (!salesOrderId) {
      return { ok: false, status: 400, message: '收款（IN）必须关联销售订单' };
    }
    // F-3C4-01：宿主 SalesOrder 必须在本用户数据范围内（SalesOrder.ownerId）
    const salesOrder = await prisma.salesOrder.findFirst({
      where: applyScope({ id: salesOrderId }, await roleScope(req, { field: 'ownerId' })),
      select: { id: true, customerId: true },
    });
    if (!salesOrder) return { ok: false, status: 404, message: '销售订单不存在' };
    if (input.customerId && input.customerId !== salesOrder.customerId) {
      return { ok: false, status: 400, message: '客户与销售订单所属客户不一致' };
    }
    return {
      ok: true,
      owner: {
        salesOrderId: salesOrder.id,
        purchaseOrderId: null,
        customerId: salesOrder.customerId,
      },
    };
  }

  // direction === OUT
  if (salesOrderId) {
    return { ok: false, status: 400, message: '付款（OUT）不得关联销售订单' };
  }
  if (!purchaseOrderId) {
    return { ok: false, status: 400, message: '付款（OUT）必须关联采购单' };
  }
  if (input.customerId) {
    return { ok: false, status: 400, message: '付款（OUT）不得写入客户' };
  }
  // F-3C4-01：宿主 PurchaseOrder 必须在本用户数据范围内（PurchaseOrder.ownerId）
  const purchaseOrder = await prisma.purchaseOrder.findFirst({
    where: applyScope({ id: purchaseOrderId }, await roleScope(req, { field: 'ownerId' })),
    select: { id: true },
  });
  if (!purchaseOrder) return { ok: false, status: 404, message: '采购单不存在' };
  return {
    ok: true,
    owner: { salesOrderId: null, purchaseOrderId: purchaseOrder.id, customerId: null },
  };
}

/**
 * 锁定受影响的 SalesOrder 行（并发硬化）。
 *
 * 目的：把「aggregate 读 → paidAmountCny 写回」纳入同一临界区。
 * recalcPaidAmountCny 由两条语句构成（SUM 聚合 + 整值覆写），写回的是**先前算好的常量**，
 * 因此在无锁情况下后提交方会以更早快照的求和值覆盖正确值（经典 lost update）。
 *
 * 约束（不得放宽）：
 *   · 只锁 `SalesOrder` —— 它是 paidAmountCny 的唯一宿主；
 *     OUT 方向宿主为 PurchaseOrder，而 PurchaseOrder **无**任何金额派生字段 ⇒ 无需加锁；
 *   · 必须 `ORDER BY id ASC` —— owner 迁移（SO-A ↔ SO-B）会同时涉及两行，
 *     确定性顺序可消除 AB/BA 循环等待；
 *   · 必须在**调用方的事务**内执行（锁随该事务提交/回滚释放）；
 *   · 入参先做 Set 去重 + 过滤空值；空数组直接返回（不得生成 `IN ()`）。
 */
async function lockSalesOrders(
  tx: Prisma.TransactionClient,
  salesOrderIds: Array<string | null | undefined>,
): Promise<void> {
  const ids = Array.from(new Set(salesOrderIds.filter((v): v is string => Boolean(v)))).sort();
  if (ids.length === 0) return;

  await tx.$queryRaw`
    SELECT id
    FROM "SalesOrder"
    WHERE id IN (${Prisma.join(ids)})
    ORDER BY id ASC
    FOR UPDATE
  `;
}

/**
 * 重算 SalesOrder.paidAmountCny = SUM(Payment.amountCny WHERE IN + CONFIRMED)。
 * 必须以「重算」取代「累加」，否则 status / amount / owner 变更后会留下错误累计。
 * SUM 忽略 NULL；无有效金额 → 写 0。
 * 调用前必须已通过 lockSalesOrders 锁定相关宿主，否则聚合与写回之间仍存在 lost update 窗口。
 */
async function recalcPaidAmountCny(
  tx: Prisma.TransactionClient,
  salesOrderId: string | null | undefined,
): Promise<void> {
  if (!salesOrderId) return;
  const agg = await tx.payment.aggregate({
    where: {
      salesOrderId,
      direction: PaymentDirection.IN,
      status: PaymentStatus.CONFIRMED,
    },
    _sum: { amountCny: true },
  });
  await tx.salesOrder.update({
    where: { id: salesOrderId },
    data: { paidAmountCny: toDecimal(agg._sum.amountCny) ?? new Prisma.Decimal(0) },
  });
}

/** 对去重后的多个 SalesOrder 依次重算 */
async function recalcAll(
  tx: Prisma.TransactionClient,
  salesOrderIds: (string | null | undefined)[],
): Promise<void> {
  const ids = Array.from(new Set(salesOrderIds.filter((v): v is string => Boolean(v))));
  for (const id of ids) {
    await recalcPaidAmountCny(tx, id);
  }
}

/**
 * 数据范围（ALL / DEPT / SELF）。
 * Payment 无 ownerId → 归属经宿主继承，且必须支持「双宿主」：
 *   OR [ { salesOrder: { ownerId } }, { purchaseOrder: { ownerId } } ]
 * ALL 档位两条 scope 均为空 → 不加限制。未新增 ownerId 列、未并入公海。
 */
async function scopedWhere(
  req: AuthRequest,
  base: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const salesOrderScope = await roleScope(req, { field: 'ownerId', relation: 'salesOrder' });
  const purchaseOrderScope = await roleScope(req, { field: 'ownerId', relation: 'purchaseOrder' });
  if (Object.keys(salesOrderScope).length === 0 && Object.keys(purchaseOrderScope).length === 0) {
    return base;
  }
  // 双宿主 OR 条件经共享 applyScope 以 AND 语义合并（不修改 scope 工具）
  return applyScope(base, { OR: [salesOrderScope, purchaseOrderScope] });
}

/**
 * DB 约束冲突识别。
 *  - unique：唯一键冲突 → 409
 *  - fk：Restrict 外键冲突 → 409
 *  - check：CHECK 约束（含 payment_exactly_one_owner_ck）→ 400（业务参数问题）
 */
function dbConstraintKind(e: unknown): 'unique' | 'fk' | 'check' | null {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2002') return 'unique';
    if (e.code === 'P2003') return 'fk';
    if (e.code === 'P2004') return 'check';
  }
  if (e instanceof Error && e.message.includes('payment_exactly_one_owner_ck')) return 'check';
  return null;
}

/** 可预期 DB 冲突 → 对应 HTTP 状态码；返回 true 表示已响应（调用方直接 return） */
function failFromDbError(res: Response, e: unknown, uniqueMessage: string): boolean {
  switch (dbConstraintKind(e)) {
    case 'unique':
      fail(res, 409, uniqueMessage);
      return true;
    case 'fk':
      fail(res, 409, '存在下游引用，操作被拒绝');
      return true;
    case 'check':
      fail(res, 400, '宿主归属校验失败：必须且只能关联销售订单或采购单之一');
      return true;
    default:
      return false;
  }
}

// ============ 列表 ============
export const listPayments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query = listQuerySchema.parse(req.query);
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

    const where = await scopedWhere(req, base);

    const pageNum = Math.max(1, Number(query.page) || 1);
    const pageSizeNum = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    const [list, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        include: PAYMENT_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * pageSizeNum,
        take: pageSizeNum,
      }),
      prisma.payment.count({ where }),
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
export const getPayment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const item = await prisma.payment.findFirst({
      where: await scopedWhere(req, { id: req.params.id }),
      include: PAYMENT_INCLUDE,
    });
    if (!item) {
      fail(res, 404, '收付款单不存在');
      return;
    }
    success(res, item);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// ============ 新建（事务：写单 + 重算 paidAmountCny） ============
export const createPayment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = createSchema.parse(req.body);

    const resolved = await resolveOwner(req, body);
    if (!resolved.ok) {
      fail(res, resolved.status, resolved.message);
      return;
    }
    const { owner } = resolved;

    const amount = round(body.amount, DECIMAL_PRECISION.amount);
    if (!amount || amount.lt(0)) {
      fail(res, 400, '金额不合法');
      return;
    }

    const currency = body.currency ?? Currency.USD;
    const exchangeRate = await resolveExchangeRate(currency, body.exchangeRate);
    const amountCny = toCny(amount, exchangeRate);
    const status = body.status ?? PaymentStatus.PENDING;

    const item = await prisma.$transaction(async (tx) => {
      // 并发硬化：先锁定受影响宿主（仅 IN 方向有 SalesOrder 宿主；OUT 传 null 自动跳过）
      await lockSalesOrders(tx, [owner.salesOrderId]);

      // 编号分配与业务写入同事务：业务失败 → 计数一并回滚，不产生编号空洞
      const paymentNo = await getNextNumber(tx, 'PAY');

      const createdPayment = await tx.payment.create({
        data: {
          paymentNo,
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
            ? { confirmedAt: new Date(), confirmedBy: req.userId ?? null }
            : {}),
          remark: body.remark ?? null,
          createdBy: req.userId ?? null,
        },
        include: PAYMENT_INCLUDE,
      });

      await recalcAll(tx, [createdPayment.salesOrderId]);
      return createdPayment;
    });

    void activityLogger.log({
      userId: req.userId ?? '',
      username: req.username ?? '',
      realName: req.realName,
      action: 'CREATE',
      module: 'fulfillment',
      businessType: BUSINESS_TYPE.PAYMENT,
      businessId: item.id,
      businessNo: item.paymentNo,
      summary: `${req.username ?? ''} 创建了${item.direction === PaymentDirection.IN ? '收款' : '付款'}单「${item.paymentNo}」`,
      ip: req.ip,
      // 仅收款（IN）写客户时间线；付款（OUT）为客户无关的供应商付款
      ...(item.customerId ? { customerId: item.customerId } : {}),
    });

    created(res, item);
  } catch (e) {
    if (e instanceof z.ZodError) {
      fail(res, 400, e.errors.map((err) => err.message).join(', '));
      return;
    }
    if (failFromDbError(res, e, '收付款单号冲突，请重试')) return;
    fail(res, 500, '服务器错误');
  }
};

// ============ 更新（事务：写单 + 对旧/新 SalesOrder 去重重算） ============
export const updatePayment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id, ...rest } = updateSchema.parse({ id: req.params.id, ...req.body });

    const existing = await prisma.payment.findFirst({
      where: await scopedWhere(req, { id }),
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
    if (!existing) {
      fail(res, 404, '收付款单不存在');
      return;
    }

    // 合并后的最终 owner 组合 → 重新完整校验（exactly-one + direction 一致 + 客户一致）
    const nextDirection = rest.direction ?? existing.direction;
    const resolved = await resolveOwner(req, {
      direction: nextDirection,
      salesOrderId: rest.salesOrderId !== undefined ? rest.salesOrderId : existing.salesOrderId,
      purchaseOrderId:
        rest.purchaseOrderId !== undefined ? rest.purchaseOrderId : existing.purchaseOrderId,
      customerId: rest.customerId !== undefined ? rest.customerId : existing.customerId,
    });
    if (!resolved.ok) {
      fail(res, resolved.status, resolved.message);
      return;
    }
    const { owner } = resolved;

    const currency = rest.currency ?? existing.currency;
    const amount =
      rest.amount !== undefined ? round(rest.amount, DECIMAL_PRECISION.amount) : toDecimal(existing.amount);
    if (!amount || amount.lt(0)) {
      fail(res, 400, '金额不合法');
      return;
    }

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
      updatedBy: req.userId ?? null,
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
        data.confirmedBy = req.userId ?? null;
      } else if (existing.status === PaymentStatus.CONFIRMED) {
        // 由已确认回退 → 清理确认留痕，避免与 status 语义不一致
        data.confirmedAt = null;
        data.confirmedBy = null;
      }
    }

    const item = await prisma.$transaction(async (tx) => {
      // 并发硬化：必须在 payment.update 之前锁定「旧宿主 + 新宿主」两行（id ASC）。
      // 新宿主取自事务外的 resolveOwner 结果（= data.salesOrderId），
      // 与 update 后的 updatedPayment.salesOrderId 恒等，故可安全前置。
      // owner 可变 ⇒ 单事务可能写两个 SalesOrder 的派生字段；排序即消除 AB/BA 死锁。
      await lockSalesOrders(tx, [existing.salesOrderId, owner.salesOrderId]);

      const updatedPayment = await tx.payment.update({
        where: { id: existing.id },
        data,
        include: PAYMENT_INCLUDE,
      });
      // 旧宿主与新宿主去重后全部重算（owner 迁移不留残留）
      await recalcAll(tx, [existing.salesOrderId, updatedPayment.salesOrderId]);
      return updatedPayment;
    });

    void activityLogger.log({
      userId: req.userId ?? '',
      username: req.username ?? '',
      realName: req.realName,
      action: 'UPDATE',
      module: 'fulfillment',
      businessType: BUSINESS_TYPE.PAYMENT,
      businessId: item.id,
      businessNo: item.paymentNo,
      summary: `${req.username ?? ''} 更新了收付款单「${item.paymentNo}」`,
      ip: req.ip,
      ...(item.customerId ? { customerId: item.customerId } : {}),
    });

    success(res, item, '更新成功');
  } catch (e) {
    if (e instanceof z.ZodError) {
      fail(res, 400, e.errors.map((err) => err.message).join(', '));
      return;
    }
    if (failFromDbError(res, e, '收付款单号冲突，请重试')) return;
    fail(res, 500, '服务器错误');
  }
};

// ============ 删除（事务：删单 + 重算 paidAmountCny） ============
export const removePayment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const existing = await prisma.payment.findFirst({
      where: await scopedWhere(req, { id: req.params.id }),
      select: { id: true, paymentNo: true, salesOrderId: true, customerId: true, direction: true },
    });
    if (!existing) {
      fail(res, 404, '收付款单不存在');
      return;
    }

    await prisma.$transaction(async (tx) => {
      // 并发硬化：先锁定宿主（OUT 宿主为 null → 自动跳过，不锁 PurchaseOrder）
      await lockSalesOrders(tx, [existing.salesOrderId]);

      await tx.payment.delete({ where: { id: existing.id } });
      // OUT 无 SalesOrder 宿主 → recalcAll 自动跳过
      await recalcAll(tx, [existing.salesOrderId]);
    });

    void activityLogger.log({
      userId: req.userId ?? '',
      username: req.username ?? '',
      realName: req.realName,
      action: 'DELETE',
      module: 'fulfillment',
      businessType: BUSINESS_TYPE.PAYMENT,
      businessId: existing.id,
      businessNo: existing.paymentNo,
      summary: `${req.username ?? ''} 删除了收付款单「${existing.paymentNo}」`,
      ip: req.ip,
      ...(existing.customerId ? { customerId: existing.customerId } : {}),
    });

    success(res, null, '删除成功');
  } catch (e) {
    if (dbConstraintKind(e) === 'fk') {
      fail(res, 409, '该收付款单存在下游引用，无法删除');
      return;
    }
    fail(res, 500, '服务器错误');
  }
};
