import { Currency, Prisma, ProfitStatus } from '@prisma/client';
import { z } from 'zod';
import { activityLogger } from '../lib/activity-logger';
import { BUSINESS_TYPE } from '../lib/business-type';
import { DomainConflictError, DomainNotFoundError, DomainValidationError } from '../lib/errors';
import {
  createProfitAggregate,
  updateProfitAggregate,
  type FreightAggregate,
  type ProfitFields,
} from '../operations/finance.operations';
import { profitRepository, salesOrderRepository } from '../repositories';
import { DECIMAL_PRECISION, round, toCny, toDecimal, type DecimalInput } from '../utils/currency';
import { applyScope } from '../scope';
import type { FinanceActorContext } from './finance.shared';
import { resolveExchangeRate } from './salesProcess.shared';

/**
 * Profit Business Layer —— Round R-5 · Phase 4 · D2 财务域
 *
 * Profit 与 SalesOrder 为 **1:1**（`salesOrderId @unique`），是成本归集结果 + 审计快照实体。
 *   · 成本项全部为本位币（CNY）Decimal；
 *   · 运费为**服务端权威**：freightCostCny = Σ Shipment.freightAmountCny（ADR-20），
 *     不接受客户端传入，每次 create/update 均重新聚合（聚合在 Operation 层、事务内完成）；
 *   · 计算口径：totalCostCny = material + outsource + packaging + labor + freight + other，
 *     profitCny = revenueCny − totalCostCny，margin = revenueCny > 0 ? profitCny / revenueCny × 100 : 0。
 *
 * 已 Deferred：profitNo runtime 之外的内容、审批流转、**DELETE endpoint**（1:1 审计实体，纠错走
 * DRAFT / 重算 / 更新）、物料/外发/包材成本由采购单自动归集、旧 order.controller 的 legacy 逻辑。
 *
 * 约束：不读 req / res、不出现 `$transaction`、不直接 import Prisma 单例。
 */

const ZERO = new Prisma.Decimal(0);

// ============================================================
// DTO
// ============================================================

const amountSchema = z.union([z.number(), z.string()]);

export const profitCreateSchema = z.object({
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

export const profitUpdateSchema = profitCreateSchema.partial().extend({
  id: z.string().min(1),
  // 1:1 宿主为不可变关系；显式传入仅用于给出 400 提示
  salesOrderId: z.string().optional(),
});

export const profitListQuerySchema = z.object({
  salesOrderId: z.string().optional(),
  status: z.nativeEnum(ProfitStatus).optional(),
  keyword: z.string().optional(),
  page: z.union([z.string(), z.number()]).optional(),
  pageSize: z.union([z.string(), z.number()]).optional(),
});

export type ProfitCreateInput = z.infer<typeof profitCreateSchema>;
export type ProfitUpdateInput = z.infer<typeof profitUpdateSchema>;
export type ProfitListQuery = z.infer<typeof profitListQuerySchema>;

/** 列表 / 详情统一 include：销售订单（归属经此）+ 客户 */
const PROFIT_INCLUDE = {
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
} satisfies Prisma.ProfitInclude;

type ProfitRow = Prisma.ProfitGetPayload<{ include: typeof PROFIT_INCLUDE }>;
type SalesOrderSource = {
  currency: Currency;
  totalAmount: Prisma.Decimal;
  totalAmountCny: Prisma.Decimal | null;
  exchangeRate: Prisma.Decimal | null;
};

// ============================================================
// 收入解析（权威顺序：显式入参 > SalesOrder 快照值 > 按 rateToCny 重算）
// ============================================================

async function resolveRevenue(
  input: {
    revenue?: DecimalInput;
    revenueCny?: DecimalInput;
    currency?: Currency;
    exchangeRate?: DecimalInput;
  },
  salesOrder: SalesOrderSource,
): Promise<{ currency: Currency; exchangeRate: Prisma.Decimal | null; revenue: Prisma.Decimal; revenueCny: Prisma.Decimal }> {
  const currency = input.currency ?? salesOrder.currency;
  const revenue = round(input.revenue ?? salesOrder.totalAmount, DECIMAL_PRECISION.amount);
  if (!revenue || revenue.lt(0)) throw new DomainValidationError('收入金额不合法');

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
    throw new DomainValidationError('无法确定本位币收入（缺少有效汇率），请显式提供 revenueCny');
  }

  return { currency, exchangeRate, revenue, revenueCny };
}

/** 成本入参（CNY 口径；freightCostCny 不入参，由 Shipment 聚合） */
interface CostInputs {
  materialCostCny?: DecimalInput;
  outsourceCostCny?: DecimalInput;
  packagingCostCny?: DecimalInput;
  laborCostCny?: DecimalInput;
  otherCostCny?: DecimalInput;
}

/** 成本 → 总额 → 利润 → 利润率 + 成本快照（全程 Decimal）。纯计算，无 IO。 */
function buildProfitFields(args: {
  currency: Currency;
  exchangeRate: Prisma.Decimal | null;
  revenue: Prisma.Decimal;
  revenueCny: Prisma.Decimal;
  inputs: CostInputs;
  freight: FreightAggregate;
}): ProfitFields {
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
  ctx: FinanceActorContext,
  base: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return applyScope(base, await ctx.scope.salesOrderOwner());
}

// ============================================================
// 列表 / 详情
// ============================================================

export async function list(query: ProfitListQuery, ctx: FinanceActorContext) {
  const base: Record<string, unknown> = {};
  if (query.salesOrderId) base.salesOrderId = query.salesOrderId;
  if (query.status) base.status = query.status;
  if (query.keyword) {
    base.OR = [
      { profitNo: { contains: query.keyword } },
      { salesOrder: { orderNo: { contains: query.keyword } } },
    ];
  }

  const where = (await scopedWhere(ctx, base)) as Prisma.ProfitWhereInput;
  const pageNum = Math.max(1, Number(query.page) || 1);
  const pageSizeNum = Math.min(100, Math.max(1, Number(query.pageSize) || 20));

  const [list, total] = await Promise.all([
    profitRepository.findMany({
      where,
      include: PROFIT_INCLUDE,
      orderBy: { createdAt: 'desc' },
      skip: (pageNum - 1) * pageSizeNum,
      take: pageSizeNum,
    }),
    profitRepository.count(where),
  ]);
  return { list, total, page: pageNum, pageSize: pageSizeNum };
}

export async function getOne(id: string, ctx: FinanceActorContext): Promise<ProfitRow> {
  const item = await profitRepository.findFirst({
    where: (await scopedWhere(ctx, { id })) as Prisma.ProfitWhereInput,
    include: PROFIT_INCLUDE,
  });
  if (!item) throw new DomainNotFoundError('利润单不存在');
  return item;
}

// ============================================================
// 新建（同一 SalesOrder 仅允许一条 → 409）
// ============================================================

export async function create(body: ProfitCreateInput, ctx: FinanceActorContext): Promise<ProfitRow> {
  // F-3C4-02：宿主 SalesOrder 必须在本用户数据范围内。
  // 必须**先于** duplicate 检查：否则 scope 外用户可凭 409 文案读到他人 profitNo。
  const salesOrder = await salesOrderRepository.findFirst({
    where: applyScope({ id: body.salesOrderId }, await ctx.scope.owner()) as Prisma.SalesOrderWhereInput,
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
  if (!salesOrder) throw new DomainNotFoundError('销售订单不存在');

  const duplicated = await profitRepository.findBySalesOrderId(salesOrder.id);
  if (duplicated) {
    throw new DomainConflictError(`该销售订单已存在利润单（${duplicated.profitNo}）`);
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

  const inputs: CostInputs = {
    materialCostCny: body.materialCostCny,
    outsourceCostCny: body.outsourceCostCny,
    packagingCostCny: body.packagingCostCny,
    laborCostCny: body.laborCostCny,
    otherCostCny: body.otherCostCny,
  };

  let item: ProfitRow;
  try {
    item = await createProfitAggregate(
      {
        salesOrderId: salesOrder.id,
        status: body.status ?? ProfitStatus.DRAFT,
        remark: body.remark ?? null,
        createdBy: ctx.userId ?? null,
      },
      // 纯计算（利润/利润率/快照）留在 Business；运费在 Operation 层事务内聚合后回调传入
      (freight) => buildProfitFields({ ...revenue, inputs, freight }),
      PROFIT_INCLUDE,
    );
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new DomainConflictError('该销售订单已存在利润单');
    }
    throw e;
  }

  void activityLogger.log({
    userId: ctx.userId ?? '',
    username: ctx.username ?? '',
    realName: ctx.realName,
    action: 'CREATE',
    module: 'fulfillment',
    businessType: BUSINESS_TYPE.PROFIT,
    businessId: item.id,
    businessNo: item.profitNo,
    summary: `${ctx.username ?? ''} 创建了利润单「${item.profitNo}」（来源订单 ${salesOrder.orderNo}）`,
    ip: ctx.ip,
    customerId: salesOrder.customerId,
  });

  return item;
}

// ============================================================
// 更新（全量重算：成本 / 总额 / 利润 / 利润率 / 快照）
// ============================================================

export async function update(id: string, rest: Omit<ProfitUpdateInput, 'id'>, ctx: FinanceActorContext): Promise<ProfitRow> {
  const existing = await profitRepository.findFirst({
    where: (await scopedWhere(ctx, { id })) as Prisma.ProfitWhereInput,
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
  if (!existing) throw new DomainNotFoundError('利润单不存在');
  if (rest.salesOrderId !== undefined && rest.salesOrderId !== existing.salesOrderId) {
    throw new DomainValidationError('不支持修改所属销售订单，请删除后重建利润单');
  }

  // F-3C4-02（对齐 create）：宿主必须在本用户数据范围内；scope 外与不存在同响应 404，
  // 且 gate 先于任何 mutation。`profit.salesOrderId` 不可变约束不变。
  const salesOrder = await salesOrderRepository.findFirst({
    where: applyScope(
      { id: existing.salesOrderId },
      await ctx.scope.owner(),
    ) as Prisma.SalesOrderWhereInput,
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
  if (!salesOrder) throw new DomainNotFoundError('销售订单不存在');

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

  const inputs: CostInputs = {
    materialCostCny: rest.materialCostCny !== undefined ? rest.materialCostCny : existing.materialCostCny,
    outsourceCostCny: rest.outsourceCostCny !== undefined ? rest.outsourceCostCny : existing.outsourceCostCny,
    packagingCostCny: rest.packagingCostCny !== undefined ? rest.packagingCostCny : existing.packagingCostCny,
    laborCostCny: rest.laborCostCny !== undefined ? rest.laborCostCny : existing.laborCostCny,
    otherCostCny: rest.otherCostCny !== undefined ? rest.otherCostCny : existing.otherCostCny,
  };

  const item = await updateProfitAggregate(
    existing.id,
    salesOrder.id,
    (freight) => buildProfitFields({ ...revenue, inputs, freight }),
    {
      ...(rest.status !== undefined ? { status: rest.status } : {}),
      ...(rest.remark !== undefined ? { remark: rest.remark } : {}),
      updatedBy: ctx.userId ?? null,
    },
    PROFIT_INCLUDE,
  );

  void activityLogger.log({
    userId: ctx.userId ?? '',
    username: ctx.username ?? '',
    realName: ctx.realName,
    action: 'UPDATE',
    module: 'fulfillment',
    businessType: BUSINESS_TYPE.PROFIT,
    businessId: item.id,
    businessNo: item.profitNo,
    summary: `${ctx.username ?? ''} 更新了利润单「${item.profitNo}」（来源订单 ${salesOrder.orderNo}）`,
    ip: ctx.ip,
    customerId: salesOrder.customerId,
  });

  return item;
}

// 说明：本域**不提供** DELETE。Profit 为 SalesOrder 1:1 的利润核算实体，
// 承载成本归集结果与 costSnapshot 审计依据；纠错应走 DRAFT / 重算 / 更新，而非物理删除。

export type { ProfitRow };
