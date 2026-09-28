import { Currency, Prisma, SampleRoundResult, SampleStatus, SampleRound } from '@prisma/client';
import { z } from 'zod';
import { activityLogger } from '../lib/activity-logger';
import { BUSINESS_TYPE } from '../lib/business-type';
import { DomainConflictError, DomainNotFoundError, DomainValidationError } from '../lib/errors';
import {
  createSampleOrderAggregate,
  createSampleRoundAggregate,
  removeSampleRoundAggregate,
} from '../operations/sales.operations';
import { customerRepository, opportunityRepository, sampleOrderRepository } from '../repositories';
import { DECIMAL_PRECISION, round } from '../utils/currency';
import { applyScope } from '../utils/scope';
import { advanceLeadStatusByOpportunityOperation } from '../operations/state.operations';
import {
  assertAssignableOwner,
  salesScopedWhere,
  type SalesActorContext,
} from './salesProcess.shared';

/**
 * SampleOrder Business Layer（Round R-5 · Phase 1 · Sales Process Domain）
 *
 * 职责：打样业务规则、轮次生命周期（roundNo 与 currentRound 的不变量）、
 * 单产品快照（ADR-04）、客户 / 商机一致性、数据范围决策、审计留痕。
 *
 * 【Sales Process 冻结】SampleOrder 属同一销售过程内的业务记录：
 *   - **不新增** `channelId` / `shopId`；
 *   - 保留「可独立发起」既有语义（`opportunityId` 可空），但**不得**重新定义销售来源。
 */

// ============================================================
// DTO
// ============================================================

const amountSchema = z.union([z.number(), z.string()]);

const roundSchema = z.object({
  designAt: z.string().optional().nullable(),
  moldAt: z.string().optional().nullable(),
  sentAt: z.string().optional().nullable(),
  feedbackAt: z.string().optional().nullable(),
  trackingNo: z.string().optional().nullable(),
  feeAmount: amountSchema.optional().nullable(),
  result: z.nativeEnum(SampleRoundResult).optional(),
  feedback: z.string().optional().nullable(),
  improvements: z.string().optional().nullable(),
});

export type SampleRoundInput = z.infer<typeof roundSchema>;

export const sampleOrderCreateSchema = z.object({
  opportunityId: z.string().optional().nullable(),
  customerId: z.string().optional().nullable(),
  productId: z.string().optional().nullable(),
  productName: z.string().optional(),
  spec: z.string().optional().nullable(),
  craft: z.string().optional().nullable(),
  size: z.string().optional().nullable(),
  packaging: z.string().optional().nullable(),
  sampleType: z.string().optional().nullable(),
  quantity: z.number().int().optional(),
  requirement: z.string().optional().nullable(),
  targetPrice: z.string().optional().nullable(),
  status: z.nativeEnum(SampleStatus).optional(),
  feeAmount: amountSchema.optional().nullable(),
  feeCurrency: z.nativeEnum(Currency).optional(),
  feeRecoverable: z.boolean().optional(),
  ownerId: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  rounds: z.array(roundSchema).optional(),
});

export const sampleOrderUpdateSchema = sampleOrderCreateSchema.partial().extend({
  id: z.string().min(1),
});

export const sampleOrderListQuerySchema = z.object({
  opportunityId: z.string().optional(),
  customerId: z.string().optional(),
  status: z.nativeEnum(SampleStatus).optional(),
  productId: z.string().optional(),
  keyword: z.string().optional(),
  page: z.union([z.string(), z.number()]).optional(),
  pageSize: z.union([z.string(), z.number()]).optional(),
});

export const sampleRoundSchema = roundSchema;

export type SampleOrderCreateInput = z.infer<typeof sampleOrderCreateSchema>;
export type SampleOrderUpdateInput = z.infer<typeof sampleOrderUpdateSchema>;
export type SampleOrderListFilters = z.infer<typeof sampleOrderListQuerySchema>;

/** 列表统一 include：客户、商机、产品、轮次（roundNo 升序） */
export const SAMPLE_ORDER_INCLUDE = {
  customer: { select: { id: true, customerNo: true, companyName: true } },
  opportunity: { select: { id: true, opportunityNo: true, title: true } },
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
  rounds: { orderBy: { roundNo: 'asc' as const } },
} satisfies Prisma.SampleOrderInclude;

/** 详情额外 include：来源打样产生的下游销售订单（真实外键在 SalesOrder 一侧） */
export const SAMPLE_ORDER_DETAIL_INCLUDE = {
  ...SAMPLE_ORDER_INCLUDE,
  salesOrders: { select: { id: true, orderNo: true, status: true } },
} satisfies Prisma.SampleOrderInclude;

type SampleOrderRow = Prisma.SampleOrderGetPayload<{ include: typeof SAMPLE_ORDER_INCLUDE }>;
type SampleOrderDetailRow = Prisma.SampleOrderGetPayload<{ include: typeof SAMPLE_ORDER_DETAIL_INCLUDE }>;

/** 轮次入参 → Prisma 写入数据（feeAmount 全程 Decimal） */
function toRoundData(
  input: SampleRoundInput,
  userId: string | null,
): Prisma.SampleRoundUncheckedCreateWithoutSampleOrderInput {
  return {
    designAt: input.designAt ? new Date(input.designAt) : null,
    moldAt: input.moldAt ? new Date(input.moldAt) : null,
    sentAt: input.sentAt ? new Date(input.sentAt) : null,
    feedbackAt: input.feedbackAt ? new Date(input.feedbackAt) : null,
    trackingNo: input.trackingNo ?? null,
    feeAmount: round(input.feeAmount ?? null, DECIMAL_PRECISION.amount),
    result: input.result ?? SampleRoundResult.PENDING,
    feedback: input.feedback ?? null,
    improvements: input.improvements ?? null,
    createdBy: userId,
  };
}

// ============================================================
// 产品快照 / 客户解析
// ============================================================

interface ProductSnapshot {
  productId: string | null;
  productName: string;
  spec: string | null;
  craft: string | null;
  size: string | null;
  packaging: string | null;
}

async function resolveProductSnapshot(
  input: {
    productId?: string | null;
    productName?: string | null;
    spec?: string | null;
    craft?: string | null;
    size?: string | null;
    packaging?: string | null;
  },
  ctx: SalesActorContext,
): Promise<ProductSnapshot> {
  let product: { id: string; name: string; packaging: string | null } | null = null;
  if (input.productId) {
    // 不可见与不存在**同结果**（400 产品不存在），不引入存在性 oracle
    product = await sampleOrderRepository.findVisibleProduct(
      input.productId,
      ctx.scope.productVisibility() as Prisma.ProductWhereInput,
    );
    if (!product) throw new DomainValidationError('产品不存在');
  }

  const productName = input.productName ?? product?.name;
  if (!productName) throw new DomainValidationError('产品名称不能为空');

  return {
    productId: product?.id ?? null,
    productName,
    spec: input.spec ?? null,
    craft: input.craft ?? null,
    size: input.size ?? null,
    packaging: input.packaging ?? product?.packaging ?? null,
  };
}

/** 解析客户：显式 customerId 优先，否则回填商机所属客户（SampleOrder.customerId 必填） */
async function resolveCustomerId(
  input: { customerId?: string | null; opportunityId?: string | null },
  ctx: SalesActorContext,
): Promise<string> {
  if (input.customerId) return input.customerId;
  if (input.opportunityId) {
    const opportunity = await opportunityRepository.findFirst({
      where: applyScope(
        { id: input.opportunityId },
        await ctx.scope.owner(),
      ) as Prisma.OpportunityWhereInput,
      select: { id: true, customerId: true },
    });
    if (!opportunity) throw new DomainValidationError('商机不存在');
    if (!opportunity.customerId) throw new DomainValidationError('客户不能为空');
    return opportunity.customerId;
  }
  throw new DomainValidationError('客户不能为空');
}

// ============================================================
// 列表 / 详情
// ============================================================

export async function listSampleOrders(filters: SampleOrderListFilters, ctx: SalesActorContext) {
  let where: Record<string, unknown> = {};
  if (filters.opportunityId) where.opportunityId = filters.opportunityId;
  if (filters.customerId) where.customerId = filters.customerId;
  if (filters.status) where.status = filters.status;
  if (filters.productId) where.productId = filters.productId;
  if (filters.keyword) {
    where.OR = [
      { sampleNo: { contains: filters.keyword } },
      { productName: { contains: filters.keyword } },
    ];
  }
  where = applyScope(where, await ctx.scope.owner());

  const pageNum = Math.max(1, Number(filters.page) || 1);
  const pageSizeNum = Math.min(100, Math.max(1, Number(filters.pageSize) || 20));
  const whereInput = where as Prisma.SampleOrderWhereInput;

  const [list, total] = await Promise.all([
    sampleOrderRepository.findMany({
      where: whereInput,
      include: SAMPLE_ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
      skip: (pageNum - 1) * pageSizeNum,
      take: pageSizeNum,
    }),
    sampleOrderRepository.countWhere(whereInput),
  ]);
  return { list, total, page: pageNum, pageSize: pageSizeNum };
}

export async function getSampleOrder(id: string, ctx: SalesActorContext): Promise<SampleOrderDetailRow> {
  const item = await sampleOrderRepository.findFirst({
    where: (await salesScopedWhere(ctx, id)) as Prisma.SampleOrderWhereInput,
    include: SAMPLE_ORDER_DETAIL_INCLUDE,
  });
  if (!item) throw new DomainNotFoundError('打样单不存在');
  return item;
}

// ============================================================
// 新建（可同时带初始轮次）
// ============================================================

export async function createSampleOrder(
  body: SampleOrderCreateInput,
  ctx: SalesActorContext,
): Promise<SampleOrderRow> {
  const customerId = await resolveCustomerId(body, ctx);
  const customer = await customerRepository.findFirst({
    where: { id: customerId },
    select: { id: true },
  });
  if (!customer) throw new DomainValidationError('客户不存在');

  if (body.opportunityId) {
    const opportunity = await opportunityRepository.findFirst({
      where: applyScope(
        { id: body.opportunityId },
        await ctx.scope.owner(),
      ) as Prisma.OpportunityWhereInput,
      select: { id: true },
    });
    if (!opportunity) throw new DomainValidationError('商机不存在');
  }

  const snapshot = await resolveProductSnapshot(body, ctx);

  const rounds = (body.rounds ?? []).map((r, index) => ({
    ...toRoundData(r, ctx.userId ?? null),
    roundNo: index + 1,
  }));
  const feeAmount = round(body.feeAmount ?? null, DECIMAL_PRECISION.amount);

  if (body.ownerId !== undefined && body.ownerId !== null) {
    await assertAssignableOwner(ctx, body.ownerId);
  }

  const item = await createSampleOrderAggregate(
    {
      customerId,
      opportunityId: body.opportunityId ?? null,
      productId: snapshot.productId,
      productName: snapshot.productName,
      spec: snapshot.spec,
      craft: snapshot.craft,
      size: snapshot.size,
      packaging: snapshot.packaging,
      sampleType: body.sampleType ?? null,
      quantity: body.quantity ?? 1,
      requirement: body.requirement ?? null,
      targetPrice: body.targetPrice ?? null,
      status: body.status ?? SampleStatus.DRAFT,
      currentRound: rounds.length > 0 ? rounds[rounds.length - 1].roundNo : 1,
      feeAmount,
      feeCurrency: body.feeCurrency ?? Currency.USD,
      feeRecoverable: body.feeRecoverable ?? false,
      ownerId: body.ownerId ?? ctx.userId ?? null,
      notes: body.notes ?? null,
      createdBy: ctx.userId ?? null,
      ...(rounds.length > 0 ? { rounds: { create: rounds } } : {}),
    },
    SAMPLE_ORDER_INCLUDE,
  );

  await activityLogger.log({
    userId: ctx.userId ?? '',
    username: ctx.username ?? '',
    realName: ctx.realName,
    action: 'CREATE',
    module: 'sales',
    businessType: BUSINESS_TYPE.SAMPLE_ORDER,
    businessId: item.id,
    businessNo: item.sampleNo,
    summary: `${ctx.username ?? ''} 创建了打样单「${item.sampleNo}」（${item.productName}）`,
    ip: ctx.ip,
    customerId,
  });

  // 线索状态自动推进（经 Opportunity.leadId 追溯）→ 已打样
  await advanceLeadStatusByOpportunityOperation(item.opportunityId, 'SAMPLED');

  return item;
}

// ============================================================
// 更新（局部更新，不触历史轮次）
// ============================================================

export async function updateSampleOrder(
  id: string,
  rest: Omit<SampleOrderUpdateInput, 'id'>,
  ctx: SalesActorContext,
): Promise<SampleOrderRow> {
  const existing = await sampleOrderRepository.findFirst({
    where: (await salesScopedWhere(ctx, id)) as Prisma.SampleOrderWhereInput,
    select: {
      id: true,
      sampleNo: true,
      customerId: true,
      productId: true,
      productName: true,
      spec: true,
      craft: true,
      size: true,
      packaging: true,
    },
  });
  if (!existing) throw new DomainNotFoundError('打样单不存在');

  const data: Prisma.SampleOrderUncheckedUpdateInput = {};

  if (rest.customerId !== undefined) {
    if (!rest.customerId) throw new DomainValidationError('客户不能为空');
    const customer = await customerRepository.findFirst({
      where: { id: rest.customerId },
      select: { id: true },
    });
    if (!customer) throw new DomainValidationError('客户不存在');
    data.customerId = rest.customerId;
  }
  if (rest.opportunityId !== undefined) {
    if (rest.opportunityId) {
      const opportunity = await opportunityRepository.findFirst({
        where: applyScope(
          { id: rest.opportunityId },
          await ctx.scope.owner(),
        ) as Prisma.OpportunityWhereInput,
        select: { id: true },
      });
      if (!opportunity) throw new DomainValidationError('商机不存在');
      data.opportunityId = rest.opportunityId;
    } else {
      data.opportunityId = null;
    }
  }

  // 产品字段任一变化 → 以「入参 > 已有快照值」重新生成快照（Product 本身不被修改）
  const productTouched =
    rest.productId !== undefined ||
    rest.productName !== undefined ||
    rest.spec !== undefined ||
    rest.craft !== undefined ||
    rest.size !== undefined ||
    rest.packaging !== undefined;
  if (productTouched) {
    const snapshot = await resolveProductSnapshot(
      {
        productId: rest.productId !== undefined ? rest.productId : existing.productId,
        productName: rest.productName !== undefined ? rest.productName : existing.productName,
        spec: rest.spec !== undefined ? rest.spec : existing.spec,
        craft: rest.craft !== undefined ? rest.craft : existing.craft,
        size: rest.size !== undefined ? rest.size : existing.size,
        packaging: rest.packaging !== undefined ? rest.packaging : existing.packaging,
      },
      ctx,
    );
    data.productId = snapshot.productId;
    data.productName = snapshot.productName;
    data.spec = snapshot.spec;
    data.craft = snapshot.craft;
    data.size = snapshot.size;
    data.packaging = snapshot.packaging;
  }

  if (rest.sampleType !== undefined) data.sampleType = rest.sampleType;
  if (rest.quantity !== undefined) data.quantity = rest.quantity;
  if (rest.requirement !== undefined) data.requirement = rest.requirement;
  if (rest.targetPrice !== undefined) data.targetPrice = rest.targetPrice;
  if (rest.status !== undefined) data.status = rest.status;
  if (rest.feeAmount !== undefined) {
    data.feeAmount = round(rest.feeAmount, DECIMAL_PRECISION.amount);
  }
  if (rest.feeCurrency !== undefined) data.feeCurrency = rest.feeCurrency;
  if (rest.feeRecoverable !== undefined) data.feeRecoverable = rest.feeRecoverable;

  // 改派归属必须通过数据范围校验，且**先于任何写入**；无公海语义，null 一律拒绝
  if (rest.ownerId !== undefined) {
    if (rest.ownerId === null || rest.ownerId === '') {
      throw new DomainValidationError('业务归属人不存在或无权限指派');
    }
    await assertAssignableOwner(ctx, rest.ownerId);
    data.ownerId = rest.ownerId;
  }
  if (rest.notes !== undefined) data.notes = rest.notes;
  data.updatedBy = ctx.userId ?? null;

  const item = await sampleOrderRepository.update({
    where: { id },
    data,
    include: SAMPLE_ORDER_INCLUDE,
  });

  await activityLogger.log({
    userId: ctx.userId ?? '',
    username: ctx.username ?? '',
    realName: ctx.realName,
    action: 'UPDATE',
    module: 'sales',
    businessType: BUSINESS_TYPE.SAMPLE_ORDER,
    businessId: item.id,
    businessNo: item.sampleNo,
    summary: `${ctx.username ?? ''} 更新了打样单「${item.sampleNo}」`,
    ip: ctx.ip,
    customerId: item.customerId,
  });

  return item;
}

// ============================================================
// 删除（物理删除；rounds 由 schema Cascade 联动删除）
// ============================================================

export async function removeSampleOrder(id: string, ctx: SalesActorContext): Promise<void> {
  const existing = await sampleOrderRepository.findFirst({
    where: (await salesScopedWhere(ctx, id)) as Prisma.SampleOrderWhereInput,
    select: { id: true, sampleNo: true, customerId: true, productName: true },
  });
  if (!existing) throw new DomainNotFoundError('打样单不存在');

  await sampleOrderRepository.delete({ where: { id: existing.id } });

  await activityLogger.log({
    userId: ctx.userId ?? '',
    username: ctx.username ?? '',
    realName: ctx.realName,
    action: 'DELETE',
    module: 'sales',
    businessType: BUSINESS_TYPE.SAMPLE_ORDER,
    businessId: existing.id,
    businessNo: existing.sampleNo,
    summary: `${ctx.username ?? ''} 删除了打样单「${existing.sampleNo}」`,
    ip: ctx.ip,
    customerId: existing.customerId,
  });
}

// ============================================================
// 轮次
// ============================================================

async function requireVisibleOrder(
  id: string,
  ctx: SalesActorContext,
): Promise<{ id: string; sampleNo: string; customerId: string }> {
  const order = await sampleOrderRepository.findFirst({
    where: (await salesScopedWhere(ctx, id)) as Prisma.SampleOrderWhereInput,
    select: { id: true, sampleNo: true, customerId: true },
  });
  if (!order) throw new DomainNotFoundError('打样单不存在');
  return order;
}

export async function listSampleRounds(id: string, ctx: SalesActorContext) {
  const order = await sampleOrderRepository.findFirst({
    where: (await salesScopedWhere(ctx, id)) as Prisma.SampleOrderWhereInput,
    select: { id: true, currentRound: true },
  });
  if (!order) throw new DomainNotFoundError('打样单不存在');
  const rounds = await sampleOrderRepository.findRounds(order.id);
  return { list: rounds, currentRound: order.currentRound };
}

export async function createSampleRound(
  id: string,
  input: SampleRoundInput,
  ctx: SalesActorContext,
): Promise<SampleRound> {
  const order = await requireVisibleOrder(id, ctx);
  try {
    const createdRound = await createSampleRoundAggregate({
      sampleOrderId: order.id,
      updatedBy: ctx.userId ?? null,
      roundData: toRoundData(input, ctx.userId ?? null),
    });

    await activityLogger.log({
      userId: ctx.userId ?? '',
      username: ctx.username ?? '',
      realName: ctx.realName,
      action: 'CREATE',
      module: 'sales',
      businessType: BUSINESS_TYPE.SAMPLE_ORDER,
      businessId: order.id,
      businessNo: order.sampleNo,
      summary: `${ctx.username ?? ''} 为打样单「${order.sampleNo}」新增第 ${createdRound.roundNo} 轮`,
      ip: ctx.ip,
      customerId: order.customerId,
    });

    return createdRound;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new DomainConflictError('轮次号冲突，请重试');
    }
    throw e;
  }
}

export async function updateSampleRound(
  id: string,
  roundId: string,
  input: SampleRoundInput,
  ctx: SalesActorContext,
): Promise<SampleRound> {
  const order = await requireVisibleOrder(id, ctx);
  const roundRow = await sampleOrderRepository.findRoundInOrder(roundId, order.id);
  if (!roundRow) throw new DomainNotFoundError('打样轮次不存在');

  const data: Prisma.SampleRoundUncheckedUpdateInput = {};
  if (input.designAt !== undefined) data.designAt = input.designAt ? new Date(input.designAt) : null;
  if (input.moldAt !== undefined) data.moldAt = input.moldAt ? new Date(input.moldAt) : null;
  if (input.sentAt !== undefined) data.sentAt = input.sentAt ? new Date(input.sentAt) : null;
  if (input.feedbackAt !== undefined) {
    data.feedbackAt = input.feedbackAt ? new Date(input.feedbackAt) : null;
  }
  if (input.trackingNo !== undefined) data.trackingNo = input.trackingNo;
  if (input.feeAmount !== undefined) {
    data.feeAmount = round(input.feeAmount, DECIMAL_PRECISION.amount);
  }
  if (input.result !== undefined) data.result = input.result;
  if (input.feedback !== undefined) data.feedback = input.feedback;
  if (input.improvements !== undefined) data.improvements = input.improvements;

  const updated = await sampleOrderRepository.updateRound({ where: { id: roundRow.id }, data });

  await activityLogger.log({
    userId: ctx.userId ?? '',
    username: ctx.username ?? '',
    realName: ctx.realName,
    action: 'UPDATE',
    module: 'sales',
    businessType: BUSINESS_TYPE.SAMPLE_ORDER,
    businessId: order.id,
    businessNo: order.sampleNo,
    summary: `${ctx.username ?? ''} 更新了打样单「${order.sampleNo}」第 ${updated.roundNo} 轮`,
    ip: ctx.ip,
    customerId: order.customerId,
  });

  return updated;
}

/** 删除指定轮次；currentRound 重算，不指向不存在的轮次（同一事务） */
export async function removeSampleRound(
  id: string,
  roundId: string,
  ctx: SalesActorContext,
): Promise<void> {
  const order = await requireVisibleOrder(id, ctx);
  const roundRow = await sampleOrderRepository.findRoundInOrder(roundId, order.id);
  if (!roundRow) throw new DomainNotFoundError('打样轮次不存在');

  await removeSampleRoundAggregate({
    sampleOrderId: order.id,
    roundId: roundRow.id,
    updatedBy: ctx.userId ?? null,
  });

  await activityLogger.log({
    userId: ctx.userId ?? '',
    username: ctx.username ?? '',
    realName: ctx.realName,
    action: 'DELETE',
    module: 'sales',
    businessType: BUSINESS_TYPE.SAMPLE_ORDER,
    businessId: order.id,
    businessNo: order.sampleNo,
    summary: `${ctx.username ?? ''} 删除了打样单「${order.sampleNo}」第 ${roundRow.roundNo} 轮`,
    ip: ctx.ip,
    customerId: order.customerId,
  });
}

export type { SampleOrderRow, SampleOrderDetailRow };
