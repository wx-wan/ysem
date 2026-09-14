import { Response } from 'express';
import { z } from 'zod';
import { Currency, Prisma, ProfitStatus } from '@prisma/client';
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
  DecimalInput,
  normalizeRate,
  round,
  toCny,
  toDecimal,
} from '../utils/currency';

// ============================================================
// 利润领域（V1.0）
//
// Profit 与 SalesOrder 为 **1:1**（`salesOrderId @unique`），是成本归集结果 + 审计快照实体。
//  - 统一使用 V1.0 Profit（**不得**回退到旧 ProfitRecord / Order）；
//  - 成本项全部为本位币（CNY）Decimal；
//  - 运费为 **服务端权威**：freightCostCny = Σ Shipment.freightAmountCny（ADR-20），
//    不接受客户端传入，每次 create/update 均重新聚合。
//
// 【计算口径】
//   totalCostCny = material + outsource + packaging + labor + freight + other
//   profitCny    = revenueCny − totalCostCny
//   margin       = revenueCny > 0 ? profitCny / revenueCny × 100 : 0   （百分数语义）
//
// 已 Deferred（不在本轮）：
//  - profitNo 走 NumberSequence runtime（当前沿用「按日最大序号 +1」做法）
//  - 审批流转（全局 approval.controller 仍为 legacy，属独立 slice）
//  - DELETE endpoint（利润为 1:1 审计实体，纠错走 DRAFT / 重算 / 更新）
//  - 物料 / 外发 / 包材成本由 PurchaseOrder 自动归集（当前仅接受显式入参）
//  - 旧 /api/orders/profits 与 order.controller.ts 的 legacy 逻辑（Order 五拆收尾）
// ============================================================

/** 列表 / 详情统一 include：销售订单（归属经此）+ 客户（CustomerActivity 用） */
const PROFIT_INCLUDE: Prisma.ProfitInclude = {
  salesOrder: {
    select: {
      id: true,
      orderNo: true,
      status: true,
      ownerId: true,
      customerId: true,
      currency: true,
      totalAmount: true,
      totalAmountCny: true,
      exchangeRate: true,
      customer: { select: { id: true, customerNo: true, companyName: true } },
    },
  },
};

const ZERO = new Prisma.Decimal(0);

/** 金额入参：JSON number / string 或已有 Decimal，一律经 Decimal 归一，禁止 JS number 参与金额运算 */
const amountSchema = z.union([z.number(), z.string()]);

const createSchema = z.object({
  salesOrderId: z.string().min(1, '销售订单不能为空'),
  revenue: amountSchema.optional(),
  revenueCny: amountSchema.optional(),
  currency: z.nativeEnum(Currency).optional(),
  exchangeRate: amountSchema.optional().nullable(),
  materialCostCny: amountSchema.optional(),
  outsourceCostCny: amountSchema.optional(),
  packagingCostCny: amountSchema.optional(),
  laborCostCny: amountSchema.optional(),
  otherCostCny: amountSchema.optional(),
  status: z.nativeEnum(ProfitStatus).optional(),
  remark: z.string().optional().nullable(),
});

const updateSchema = createSchema.partial().extend({
  id: z.string().min(1),
  // 1:1 宿主为不可变关系；显式传入仅用于给出 400 提示
  salesOrderId: z.string().optional(),
});

const listQuerySchema = z.object({
  salesOrderId: z.string().optional(),
  status: z.nativeEnum(ProfitStatus).optional(),
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
  input?: DecimalInput,
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

type SalesOrderSource = {
  currency: Currency;
  totalAmount: Prisma.Decimal;
  totalAmountCny: Prisma.Decimal | null;
  exchangeRate: Prisma.Decimal | null;
};

interface RevenueInput {
  revenue?: DecimalInput;
  revenueCny?: DecimalInput;
  currency?: Currency;
  exchangeRate?: DecimalInput;
}

type RevenueResult =
  | {
      ok: true;
      currency: Currency;
      exchangeRate: Prisma.Decimal | null;
      revenue: Prisma.Decimal;
      revenueCny: Prisma.Decimal;
    }
  | { ok: false; message: string };

/**
 * 收入 / 币种 / 汇率 / 本位币收入解析。
 *
 * 权威顺序：显式入参 > SalesOrder 快照值 > 按 rateToCny 重算。
 * 三者皆无法确定本位币收入时返回失败 —— **不伪造** amountCny。
 */
async function resolveRevenue(
  input: RevenueInput,
  salesOrder: SalesOrderSource,
): Promise<RevenueResult> {
  const currency = input.currency ?? salesOrder.currency;
  const revenue = round(input.revenue ?? salesOrder.totalAmount, DECIMAL_PRECISION.amount);
  if (!revenue || revenue.lt(0)) return { ok: false, message: '收入金额不合法' };

  let exchangeRate: Prisma.Decimal | null;
  if (input.exchangeRate !== undefined) {
    exchangeRate = await resolveExchangeRate(currency, input.exchangeRate);
  } else if (input.currency !== undefined) {
    // 币种变化 → 旧汇率已失效，必须重新取汇
    exchangeRate = await resolveExchangeRate(currency, null);
  } else {
    exchangeRate = toDecimal(salesOrder.exchangeRate);
  }

  let revenueCny = round(input.revenueCny ?? null, DECIMAL_PRECISION.amount);
  if (!revenueCny) revenueCny = toDecimal(salesOrder.totalAmountCny);
  if (!revenueCny) revenueCny = toCny(revenue, exchangeRate);
  if (!revenueCny) {
    return { ok: false, message: '无法确定本位币收入（缺少有效汇率），请显式提供 revenueCny' };
  }

  return { ok: true, currency, exchangeRate, revenue, revenueCny };
}

/** 成本入参（CNY 口径；freightCostCny 不入参，由 Shipment 聚合） */
interface CostInputs {
  materialCostCny?: DecimalInput;
  outsourceCostCny?: DecimalInput;
  packagingCostCny?: DecimalInput;
  laborCostCny?: DecimalInput;
  otherCostCny?: DecimalInput;
}

/**
 * 运费归集（ADR-20）：Σ Shipment.freightAmountCny（WHERE salesOrderId = X）。
 * NULL 的 freightAmountCny 不计入 SUM；无有效运费 → 0。
 */
async function aggregateFreight(
  tx: Prisma.TransactionClient,
  salesOrderId: string,
): Promise<{ value: Prisma.Decimal; contributingCount: number; totalCount: number }> {
  const shipments = await tx.shipment.findMany({
    where: { salesOrderId },
    select: { freightAmountCny: true },
  });
  let value = ZERO;
  let contributingCount = 0;
  for (const shipment of shipments) {
    const amount = toDecimal(shipment.freightAmountCny);
    if (!amount) continue;
    value = value.plus(amount);
    contributingCount += 1;
  }
  return {
    value: value.toDecimalPlaces(DECIMAL_PRECISION.amount, Prisma.Decimal.ROUND_HALF_UP),
    contributingCount,
    totalCount: shipments.length,
  };
}

/** 成本 → 总额 → 利润 → 利润率 + 成本快照（全程 Decimal） */
function buildProfitFields(args: {
  currency: Currency;
  exchangeRate: Prisma.Decimal | null;
  revenue: Prisma.Decimal;
  revenueCny: Prisma.Decimal;
  inputs: CostInputs;
  freight: { value: Prisma.Decimal; contributingCount: number; totalCount: number };
}) {
  const cost = (value: DecimalInput): Prisma.Decimal =>
    round(value ?? 0, DECIMAL_PRECISION.amount) ?? ZERO;

  const materialCostCny = cost(args.inputs.materialCostCny);
  const outsourceCostCny = cost(args.inputs.outsourceCostCny);
  const packagingCostCny = cost(args.inputs.packagingCostCny);
  const laborCostCny = cost(args.inputs.laborCostCny);
  const otherCostCny = cost(args.inputs.otherCostCny);
  const freightCostCny = args.freight.value;

  const totalCostCny = [
    materialCostCny,
    outsourceCostCny,
    packagingCostCny,
    laborCostCny,
    freightCostCny,
    otherCostCny,
  ]
    .reduce((acc, cur) => acc.plus(cur), ZERO)
    .toDecimalPlaces(DECIMAL_PRECISION.amount, Prisma.Decimal.ROUND_HALF_UP);

  const profitCny = args.revenueCny
    .minus(totalCostCny)
    .toDecimalPlaces(DECIMAL_PRECISION.amount, Prisma.Decimal.ROUND_HALF_UP);

  const margin = args.revenueCny.gt(0)
    ? profitCny
        .div(args.revenueCny)
        .times(100)
        .toDecimalPlaces(DECIMAL_PRECISION.ratio, Prisma.Decimal.ROUND_HALF_UP)
    : ZERO;

  // 快照：Decimal 一律以字符串写入，避免 JSON number 精度丢失（ADR-16）
  const costSnapshot: Prisma.InputJsonValue = {
    materialCostCny: materialCostCny.toFixed(),
    outsourceCostCny: outsourceCostCny.toFixed(),
    packagingCostCny: packagingCostCny.toFixed(),
    laborCostCny: laborCostCny.toFixed(),
    freightCostCny: freightCostCny.toFixed(),
    otherCostCny: otherCostCny.toFixed(),
    totalCostCny: totalCostCny.toFixed(),
    revenue: args.revenue.toFixed(),
    revenueCny: args.revenueCny.toFixed(),
    profitCny: profitCny.toFixed(),
    margin: margin.toFixed(),
    currency: args.currency,
    exchangeRate: args.exchangeRate ? args.exchangeRate.toFixed() : null,
    freightSource: {
      source: 'Shipment.freightAmountCny',
      freightCostCny: freightCostCny.toFixed(),
      shipmentCount: args.freight.contributingCount,
      totalShipmentCount: args.freight.totalCount,
    },
  };

  return {
    revenue: args.revenue,
    revenueCny: args.revenueCny,
    currency: args.currency,
    exchangeRate: args.exchangeRate,
    materialCostCny,
    outsourceCostCny,
    packagingCostCny,
    laborCostCny,
    freightCostCny,
    otherCostCny,
    totalCostCny,
    profitCny,
    margin,
    costSnapshot,
    calculatedAt: new Date(),
  };
}

/** 数据范围（ALL / DEPT / SELF）：Profit 无 ownerId → 经 salesOrder.ownerId 继承 */
async function scopedWhere(
  req: AuthRequest,
  base: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return applyScope(base, await roleScope(req, { field: 'ownerId', relation: 'salesOrder' }));
}

function isUniqueError(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

// ============ 列表 ============
export const listProfits = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query = listQuerySchema.parse(req.query);
    const base: Record<string, unknown> = {};
    if (query.salesOrderId) base.salesOrderId = query.salesOrderId;
    if (query.status) base.status = query.status;
    if (query.keyword) {
      base.OR = [
        { profitNo: { contains: query.keyword } },
        { salesOrder: { orderNo: { contains: query.keyword } } },
      ];
    }

    const where = await scopedWhere(req, base);

    const pageNum = Math.max(1, Number(query.page) || 1);
    const pageSizeNum = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    const [list, total] = await Promise.all([
      prisma.profit.findMany({
        where,
        include: PROFIT_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * pageSizeNum,
        take: pageSizeNum,
      }),
      prisma.profit.count({ where }),
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
export const getProfit = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const item = await prisma.profit.findFirst({
      where: await scopedWhere(req, { id: req.params.id }),
      include: PROFIT_INCLUDE,
    });
    if (!item) {
      fail(res, 404, '利润单不存在');
      return;
    }
    success(res, item);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// ============ 新建（同一 SalesOrder 仅允许一条 → 409） ============
export const createProfit = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = createSchema.parse(req.body);

    const salesOrder = await prisma.salesOrder.findUnique({
      where: { id: body.salesOrderId },
      select: {
        id: true,
        orderNo: true,
        customerId: true,
        currency: true,
        totalAmount: true,
        totalAmountCny: true,
        exchangeRate: true,
      },
    });
    if (!salesOrder) {
      fail(res, 404, '销售订单不存在');
      return;
    }

    const duplicated = await prisma.profit.findUnique({
      where: { salesOrderId: salesOrder.id },
      select: { id: true, profitNo: true },
    });
    if (duplicated) {
      fail(res, 409, `该销售订单已存在利润单（${duplicated.profitNo}）`);
      return;
    }

    const revenue = await resolveRevenue(
      {
        revenue: body.revenue,
        revenueCny: body.revenueCny,
        currency: body.currency,
        exchangeRate: body.exchangeRate,
      },
      salesOrder,
    );
    if (!revenue.ok) {
      fail(res, 400, revenue.message);
      return;
    }

    const status = body.status ?? ProfitStatus.DRAFT;

    const item = await prisma.$transaction(async (tx) => {
      // 编号分配与业务写入同事务：业务失败 → 计数一并回滚，不产生编号空洞
      const profitNo = await getNextNumber(tx, 'PRF');

      // 运费由服务端从 Shipment 聚合，客户端传入一律忽略
      const freight = await aggregateFreight(tx, salesOrder.id);
      const fields = buildProfitFields({
        currency: revenue.currency,
        exchangeRate: revenue.exchangeRate,
        revenue: revenue.revenue,
        revenueCny: revenue.revenueCny,
        inputs: {
          materialCostCny: body.materialCostCny,
          outsourceCostCny: body.outsourceCostCny,
          packagingCostCny: body.packagingCostCny,
          laborCostCny: body.laborCostCny,
          otherCostCny: body.otherCostCny,
        },
        freight,
      });

      return tx.profit.create({
        data: {
          profitNo,
          salesOrderId: salesOrder.id,
          status,
          remark: body.remark ?? null,
          createdBy: req.userId ?? null,
          ...fields,
        },
        include: PROFIT_INCLUDE,
      });
    });

    void activityLogger.log({
      userId: req.userId ?? '',
      username: req.username ?? '',
      realName: req.realName,
      action: 'CREATE',
      module: 'fulfillment',
      businessType: BUSINESS_TYPE.PROFIT,
      businessId: item.id,
      businessNo: item.profitNo,
      summary: `${req.username ?? ''} 创建了利润单「${item.profitNo}」（来源订单 ${salesOrder.orderNo}）`,
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
      fail(res, 409, '该销售订单已存在利润单');
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// ============ 更新（全量重算：成本 / 总额 / 利润 / 利润率 / 快照） ============
export const updateProfit = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id, ...rest } = updateSchema.parse({ id: req.params.id, ...req.body });

    const existing = await prisma.profit.findFirst({
      where: await scopedWhere(req, { id }),
      select: {
        id: true,
        profitNo: true,
        salesOrderId: true,
        revenue: true,
        revenueCny: true,
        currency: true,
        materialCostCny: true,
        outsourceCostCny: true,
        packagingCostCny: true,
        laborCostCny: true,
        otherCostCny: true,
        status: true,
      },
    });
    if (!existing) {
      fail(res, 404, '利润单不存在');
      return;
    }
    if (rest.salesOrderId !== undefined && rest.salesOrderId !== existing.salesOrderId) {
      fail(res, 400, '不支持修改所属销售订单，请删除后重建利润单');
      return;
    }

    const salesOrder = await prisma.salesOrder.findUnique({
      where: { id: existing.salesOrderId },
      select: {
        id: true,
        orderNo: true,
        customerId: true,
        currency: true,
        totalAmount: true,
        totalAmountCny: true,
        exchangeRate: true,
      },
    });
    if (!salesOrder) {
      fail(res, 400, '销售订单不存在');
      return;
    }

    // 更新以现有 Profit 值为基线（快照不因 SalesOrder 后续变化而自动漂移），显式入参优先
    const revenue = await resolveRevenue(
      {
        revenue: rest.revenue !== undefined ? rest.revenue : existing.revenue,
        revenueCny: rest.revenueCny !== undefined ? rest.revenueCny : existing.revenueCny,
        currency: rest.currency,
        exchangeRate: rest.exchangeRate,
      },
      salesOrder,
    );
    if (!revenue.ok) {
      fail(res, 400, revenue.message);
      return;
    }

    const item = await prisma.$transaction(async (tx) => {
      // 运费每次都由 Shipment 重新聚合（server authoritative）
      const freight = await aggregateFreight(tx, salesOrder.id);
      const fields = buildProfitFields({
        currency: revenue.currency,
        exchangeRate: revenue.exchangeRate,
        revenue: revenue.revenue,
        revenueCny: revenue.revenueCny,
        inputs: {
          materialCostCny:
            rest.materialCostCny !== undefined ? rest.materialCostCny : existing.materialCostCny,
          outsourceCostCny:
            rest.outsourceCostCny !== undefined ? rest.outsourceCostCny : existing.outsourceCostCny,
          packagingCostCny:
            rest.packagingCostCny !== undefined ? rest.packagingCostCny : existing.packagingCostCny,
          laborCostCny: rest.laborCostCny !== undefined ? rest.laborCostCny : existing.laborCostCny,
          otherCostCny: rest.otherCostCny !== undefined ? rest.otherCostCny : existing.otherCostCny,
        },
        freight,
      });

      return tx.profit.update({
        where: { id: existing.id },
        data: {
          ...fields,
          ...(rest.status !== undefined ? { status: rest.status } : {}),
          ...(rest.remark !== undefined ? { remark: rest.remark } : {}),
          updatedBy: req.userId ?? null,
        },
        include: PROFIT_INCLUDE,
      });
    });

    void activityLogger.log({
      userId: req.userId ?? '',
      username: req.username ?? '',
      realName: req.realName,
      action: 'UPDATE',
      module: 'fulfillment',
      businessType: BUSINESS_TYPE.PROFIT,
      businessId: item.id,
      businessNo: item.profitNo,
      summary: `${req.username ?? ''} 更新了利润单「${item.profitNo}」（来源订单 ${salesOrder.orderNo}）`,
      ip: req.ip,
      customerId: salesOrder.customerId,
    });

    success(res, item, '更新成功');
  } catch (e) {
    if (e instanceof z.ZodError) {
      fail(res, 400, e.errors.map((err) => err.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// 说明：本轮**不提供** DELETE /api/profits/:id。
// Profit 为 SalesOrder 1:1 的利润核算实体，承载成本归集结果与 costSnapshot 审计依据；
// 纠错应走 DRAFT / 重算 / 更新，而非物理删除。
