import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { activityLogger } from '../lib/activity-logger';
import { BUSINESS_TYPE } from '../lib/business-type';
import { DomainNotFoundError, DomainValidationError } from '../lib/errors';
import {
  createOpportunityAggregate,
  updateOpportunityAggregate,
} from '../operations/sales.operations';
import {
  customerRepository,
  leadRepository,
  operationLogRepository,
  opportunityRepository,
  userRepository,
} from '../repositories';
import { advanceLeadStatusOperation, deriveOpportunityStagesOperation } from '../operations/state.operations';
import { applyScope } from '../scope';
import {
  findVisibleProductNames,
  salesScopedWhere,
  assertAssignableOwner,
  type SalesActorContext,
} from './salesProcess.shared';

/**
 * Opportunity Business Layer（Round R-5 · Phase 1 · Sales Process Domain）
 *
 * 职责：商机业务规则、Sales Process 起点继承（**冻结 D7**）、数据范围决策、
 * 事务编排入口、审计留痕。
 *
 * 约束：
 *   - 不读取 / 不返回 HTTP；业务失败以 `DomainError` 表达；
 *   - **不直接调用 Prisma**：数据访问经 repositories / operations。
 *
 * 【Round R-5 B1 / D7 冻结落地】
 *   - `Opportunity.channelId / shopId` **不是商机自有业务字段**，而是
 *     「Sales Process Starting Fact」在商机上的承载，**唯一来源是 Lead**；
 *   - 创建：`leadId` 为**强前置关系**，缺失 / 无效 → 拒绝；渠道**服务端**从 Lead 派生，
 *     客户端提交的 channelId / shopId 一律不作为可信来源；
 *   - 更新：`channelId` / `shopId` / `leadId` **不可修改**，尝试修改 → 400 REJECT
 *     （不静默改写，不产生数据漂移）；
 *   - 商机**不维护**独立落库终态（`outcome` / `wonAt` / `lostReason` 无写入入口）。
 */

// ============================================================
// DTO / 校验
// ============================================================

const INTENT_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'READY'] as const;

/** 旧版 probability 存的是中文意向文案，V1.0 对应 Opportunity.intentLevel */
const LEGACY_PROBABILITY_TO_INTENT: Record<string, (typeof INTENT_LEVELS)[number]> = {
  低意向: 'LOW',
  中意向: 'MEDIUM',
  高意向: 'HIGH',
  准成交: 'READY',
};

export const opportunityCreateSchema = z.object({
  customerId: z.string().min(1, '客户不能为空'),
  // B2 冻结：商机必须来自线索 —— leadId 为强前置关系，缺失即 400
  leadId: z.string().min(1, '线索不能为空'),
  title: z.string().min(1, '标题不能为空'),
  estimatedAmount: z.number().optional().nullable(),
  estimatedCloseDate: z.string().optional().nullable(),
  /** 兼容旧字段：既可能是中文意向文案（→ intentLevel），也可能是数字概率字符串（→ probability） */
  probability: z.string().optional().nullable(),
  intentLevel: z.enum(INTENT_LEVELS).optional().nullable(),
  notes: z.string().optional().nullable(),
  ownerId: z.string().optional().nullable(),
  // 来源渠道 / 平台：**保留入参形状以维持 API Contract**，但服务端不采信（一律由 Lead 派生）
  channelId: z.string().optional().nullable(),
  shopId: z.string().optional().nullable(),
  products: z
    .array(
      z.object({
        productId: z.string(),
        quantity: z.number().int().positive().optional(),
      }),
    )
    .optional()
    .nullable(),
});

export const opportunityUpdateSchema = opportunityCreateSchema.partial();

export type OpportunityCreateInput = z.infer<typeof opportunityCreateSchema>;

/** 商机详情统一 include（owner / customer / lead / channel / shop / items） */
const OPPORTUNITY_INCLUDE = {
  owner: { select: { id: true, realName: true, username: true } },
  customer: { select: { id: true, companyName: true, contactName: true } },
  lead: { select: { id: true, leadNo: true, leadName: true } },
  channel: { select: { id: true, name: true } },
  shop: { select: { id: true, name: true } },
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
} satisfies Prisma.OpportunityInclude;

export { OPPORTUNITY_INCLUDE };

/** 将旧版 probability 文案/数字拆分为 V1.0 的 intentLevel 与 probability */
export function splitProbability(raw?: string | null): {
  intentLevel?: (typeof INTENT_LEVELS)[number];
  probability?: number;
} {
  if (raw === undefined || raw === null || raw === '') return {};
  const mapped = LEGACY_PROBABILITY_TO_INTENT[raw];
  if (mapped) return { intentLevel: mapped };
  const n = Number(raw);
  return Number.isNaN(n) ? {} : { probability: n };
}

/** 构建 OpportunityItem 创建数据（V1.0 要求 productName 快照） */
async function buildItems(
  products: { productId: string; quantity?: number }[] | null | undefined,
  ctx: SalesActorContext,
): Promise<{ productId: string; productName: string; quantity: number }[]> {
  if (!products || products.length === 0) return [];
  const found = await findVisibleProductNames(
    products.map((p) => p.productId),
    ctx,
  );
  const nameById = new Map(found.map((p) => [p.id, p.name]));
  return products
    .filter((p) => nameById.has(p.productId))
    .map((p) => ({
      productId: p.productId,
      productName: nameById.get(p.productId)!,
      quantity: p.quantity ?? 1,
    }));
}

// ============================================================
// Sales Process 起点（B2 / D7）
// ============================================================

/**
 * 解析并授权来源线索 —— 商机创建的**唯一** Sales Process 起点来源。
 *
 * 数据范围：与 Lead 详情同等口径（`applyScope` + `roleScope(ownerId)`，**不并入公海**）。
 * 不可见与不存在**同文案**（400「线索不存在」），不引入存在性 oracle。
 */
async function resolveScopedLead(
  leadId: string,
  ctx: SalesActorContext,
): Promise<{ id: string; channelId: string | null; shopId: string | null }> {
  const lead = await leadRepository.findFirst({
    where: await salesScopedWhere(ctx, leadId),
    select: { id: true, channelId: true, shopId: true },
  });
  if (!lead) throw new DomainValidationError('线索不存在');
  return lead;
}

// ============================================================
// 列表 / 看板 / 详情 / 记录
// ============================================================

export interface OpportunityListFilters {
  page?: string;
  pageSize?: string;
  keyword?: string;
  stage?: string;
  ownerId?: string;
  channel?: string;
  platform?: string;
  startDate?: string;
  endDate?: string;
}

export async function listOpportunities(filters: OpportunityListFilters, ctx: SalesActorContext) {
  // 既有分页口径逐字沿用：
  //  · 常规路径经 `paginateList` ⇒ page 与 pageSize 均被夹取（pageSize ∈ [1,100]）
  //  · 阶段派生路径为既有实现，**不做夹取**（保持迁移前行为）
  const rawPage = Number(filters.page ?? '1');
  const rawPageSize = Number(filters.pageSize ?? '20');
  const pageNum = Math.max(1, rawPage || 1);
  const pageSizeNum = Math.min(100, Math.max(1, rawPageSize || 20));
  const stagePageNum = rawPage;
  const stagePageSizeNum = rawPageSize;
  const keyword = filters.keyword ?? '';

  let where: Record<string, unknown> = {};
  const AND: unknown[] = [];

  if (keyword) {
    AND.push({
      OR: [
        { title: { contains: keyword } },
        { customer: { companyName: { contains: keyword } } },
      ],
    });
  }
  if (filters.startDate || filters.endDate) {
    const dateFilter: Record<string, string> = {};
    if (filters.startDate) dateFilter.gte = filters.startDate;
    if (filters.endDate) dateFilter.lte = filters.endDate;
    where.createdAt = dateFilter;
  }
  // 来源渠道 / 平台筛选（对齐线索页：channel = 渠道，platform = 平台/shopId）
  if (filters.channel) where.channelId = filters.channel;
  if (filters.platform) where.shopId = filters.platform;

  if (filters.ownerId) where.ownerId = filters.ownerId;
  where = applyScope(where, await ctx.scope.owner());

  if (AND.length > 0) {
    where.AND = [...((where.AND ?? []) as unknown[]), ...AND];
  }

  const whereInput = where as Prisma.OpportunityWhereInput;

  // 阶段为派生值，无法通过 SQL 直接过滤：先取全量再过滤分页
  if (filters.stage) {
    const all = await opportunityRepository.findMany({
      where: whereInput,
      include: OPPORTUNITY_INCLUDE,
      orderBy: { updatedAt: 'desc' },
    });
    const stageMap = await deriveOpportunityStagesOperation(all);
    const filtered = all.filter((o) => stageMap.get(o.id) === filters.stage);
    const total = filtered.length;
    const slice = filtered.slice(
      (stagePageNum - 1) * stagePageSizeNum,
      stagePageNum * stagePageSizeNum,
    );
    return {
      list: slice.map((o) => ({ ...o, stage: stageMap.get(o.id) })),
      total,
      page: stagePageNum,
      pageSize: stagePageSizeNum,
    };
  }

  const [list, total] = await Promise.all([
    opportunityRepository.findMany({
      where: whereInput,
      include: OPPORTUNITY_INCLUDE,
      orderBy: { updatedAt: 'desc' },
      skip: (pageNum - 1) * pageSizeNum,
      take: pageSizeNum,
    }),
    opportunityRepository.count(whereInput),
  ]);

  const stageMap = await deriveOpportunityStagesOperation(list);
  return {
    list: list.map((o) => ({ ...o, stage: stageMap.get(o.id) })),
    total,
    page: pageNum,
    pageSize: pageSizeNum,
  };
}

/** 详情：数据范围门后仍不存在 ⇒ 与越权同响应 404「记录不存在」 */
export async function getOpportunity(id: string, ctx: SalesActorContext) {
  const opportunity = await opportunityRepository.findFirst({
    where: (await salesScopedWhere(ctx, id)) as Prisma.OpportunityWhereInput,
    include: OPPORTUNITY_INCLUDE,
  });
  if (!opportunity) throw new DomainNotFoundError('记录不存在');
  const stageMap = await deriveOpportunityStagesOperation([opportunity]);
  return { ...opportunity, stage: stageMap.get(opportunity.id) };
}

/** 操作记录：只读 OperationLog 中 businessType=OPPORTUNITY 的记录（受数据范围约束） */
export async function getSalesLogs(id: string, ctx: SalesActorContext) {
  const opportunity = await opportunityRepository.findFirst({
    where: (await salesScopedWhere(ctx, id)) as Prisma.OpportunityWhereInput,
    select: { id: true },
  });
  if (!opportunity) throw new DomainNotFoundError('记录不存在');
  return operationLogRepository.findByBusiness(
    { businessType: BUSINESS_TYPE.OPPORTUNITY, businessId: opportunity.id },
    100,
  );
}

export async function getByProduct(productId: string, ctx: SalesActorContext) {
  const where = {
    items: { some: { productId } },
    ...(await ctx.scope.owner()),
  } as Prisma.OpportunityWhereInput;

  const opportunities = await opportunityRepository.findMany({
    where,
    include: {
      owner: { select: { id: true, realName: true, username: true } },
      customer: { select: { id: true, companyName: true, contactName: true } },
      items: { where: { productId }, select: { quantity: true }, orderBy: { sort: 'asc' } },
    },
    orderBy: { updatedAt: 'desc' },
  });

  const stageMap = await deriveOpportunityStagesOperation(opportunities);

  const list = opportunities.map((o) => ({
    id: o.id,
    opportunityNo: o.opportunityNo,
    title: o.title,
    companyName: o.customer?.companyName ?? null,
    contactName: o.customer?.contactName ?? null,
    stage: stageMap.get(o.id),
    status: stageMap.get(o.id),
    estimatedAmount: o.estimatedAmount,
    amountCNY: o.estimatedAmount,
    updateTime: o.updatedAt,
    quantity: o.items.reduce((s, it) => s + (it.quantity || 0), 0),
    assignee: o.owner,
  }));

  return { list, total: list.length };
}

export async function getByCustomer(customerId: string, ctx: SalesActorContext) {
  const where = {
    customerId,
    ...(await ctx.scope.owner()),
  } as Prisma.OpportunityWhereInput;
  return opportunityRepository.findMany({ where, orderBy: { updatedAt: 'desc' } });
}

/** 可分配用户列表（商机页下拉；无数据范围语义，沿用既有行为） */
export function getAssignUsers() {
  return userRepository.findActiveBasicList();
}

// ============================================================
// 创建（B2 / D7：leadId 强前置 + 渠道服务端派生）
// ============================================================

export async function createOpportunity(
  body: OpportunityCreateInput,
  ctx: SalesActorContext,
): Promise<OpportunityWithInclude> {
  // 1) 客户必须存在（Restrict）
  const customer = await customerRepository.findFirst({
    where: { id: body.customerId },
    select: { id: true },
  });
  if (!customer) throw new DomainValidationError('客户不存在');

  // 2) Sales Process 起点：Lead 必须存在且在当前数据范围内（B2 强前置关系）
  //
  // R-5 · PHASE 6（收口 PHASE 5 发现 F1）：B2 原本仅在**边界**强制
  // （`opportunityCreateSchema` 的 POST /api/sales 与 Excel 导入的行级校验）。
  // 此处补一条**领域函数级**断言作纵深防御，防止未来新增内部调用方绕过边界。
  // 对现有两个真实入口属**行为不变**的纯加固。
  if (!body.leadId) throw new DomainValidationError('线索不能为空');

  const lead = await resolveScopedLead(body.leadId, ctx);

  // 3) 归属人可指派校验（未指定 / null 一律回落当前用户）
  if (body.ownerId !== undefined && body.ownerId !== null) {
    await assertAssignableOwner(ctx, body.ownerId);
  }

  const { intentLevel, probability } = splitProbability(body.probability);
  const items = await buildItems(body.products, ctx);

  // 4) 编号分配与业务写入同事务（Operation 层持有）
  const opportunity = await createOpportunityAggregate(
    {
      title: body.title,
      customerId: body.customerId,
      leadId: lead.id,
      // D7：渠道一律来自 Lead 的 Sales Process Starting Fact，**不采信客户端入参**
      channelId: lead.channelId ?? null,
      shopId: lead.shopId ?? null,
      ownerId: body.ownerId ?? ctx.userId ?? null,
      estimatedAmount: body.estimatedAmount ?? undefined,
      estimatedCloseDate: body.estimatedCloseDate ? new Date(body.estimatedCloseDate) : null,
      intentLevel: body.intentLevel ?? intentLevel ?? undefined,
      probability,
      notes: body.notes ?? undefined,
      items: items.length > 0 ? { create: items } : undefined,
    },
    OPPORTUNITY_INCLUDE,
  );

  await activityLogger.log({
    userId: ctx.userId ?? '',
    username: ctx.username ?? '',
    action: 'OPPORTUNITY_CREATED',
    module: 'sales',
    businessType: BUSINESS_TYPE.OPPORTUNITY,
    businessId: opportunity.id,
    businessNo: opportunity.opportunityNo,
    summary: `创建了商机「${body.title}」`,
    customerId: body.customerId,
  });

  // 线索状态自动推进：商机绑定线索（Opportunity.leadId）→ 线索置为「已确认」
  await advanceLeadStatusOperation(opportunity.leadId, 'CONFIRMED');

  if (opportunity.leadId) {
    await activityLogger.log({
      userId: ctx.userId ?? '',
      username: ctx.username ?? '',
      realName: ctx.realName,
      action: 'STATUS',
      module: 'sales',
      businessType: BUSINESS_TYPE.LEAD,
      businessId: opportunity.leadId,
      summary: `确认转为商机（${opportunity.opportunityNo}）`,
    });
  }

  return opportunity;
}

type OpportunityWithInclude = Prisma.OpportunityGetPayload<{ include: typeof OPPORTUNITY_INCLUDE }>;

// ============================================================
// 更新（D7：Starting Fact 不可修改）
// ============================================================

export type OpportunityUpdateInput = z.infer<typeof opportunityUpdateSchema>;

export async function updateOpportunity(
  id: string,
  body: OpportunityUpdateInput,
  ctx: SalesActorContext,
): Promise<OpportunityWithInclude> {
  const existing = await opportunityRepository.findFirst({
    where: (await salesScopedWhere(ctx, id)) as Prisma.OpportunityWhereInput,
    select: {
      id: true,
      title: true,
      estimatedAmount: true,
      notes: true,
      customerId: true,
      leadId: true,
      channelId: true,
      shopId: true,
    },
  });
  if (!existing) throw new DomainNotFoundError('记录不存在');

  // ---- D7 门：Sales Process Starting Fact 不可通过商机修改（先于任何写入）----
  assertStartingFactUnchanged(body, existing);

  if (body.ownerId !== undefined && body.ownerId !== null) {
    await assertAssignableOwner(ctx, body.ownerId);
  }

  const { products, probability, ...opportunityData } = body;
  // 已在上方门中校验；此处从写入载荷中剔除，确保不落库
  delete (opportunityData as Record<string, unknown>).channelId;
  delete (opportunityData as Record<string, unknown>).shopId;
  delete (opportunityData as Record<string, unknown>).leadId;

  const items = products !== undefined ? await buildItems(products, ctx) : [];
  const { intentLevel, probability: numericProbability } = splitProbability(probability);

  const updateData: Prisma.OpportunityUncheckedUpdateInput = {
    ...opportunityData,
    estimatedCloseDate:
      body.estimatedCloseDate === undefined
        ? undefined
        : body.estimatedCloseDate
          ? new Date(body.estimatedCloseDate)
          : null,
    intentLevel: body.intentLevel ?? intentLevel,
    probability: numericProbability,
    items: products !== undefined && items.length > 0 ? { create: items } : undefined,
  };
  if (body.intentLevel === undefined && intentLevel === undefined) delete updateData.intentLevel;
  if (numericProbability === undefined) delete updateData.probability;

  const opportunity = await updateOpportunityAggregate({
    id: existing.id,
    data: updateData,
    include: OPPORTUNITY_INCLUDE,
    replaceItems: products !== undefined,
  });

  const changes: string[] = [];
  if (body.title && body.title !== existing.title) changes.push('标题');
  if (body.estimatedAmount !== undefined && body.estimatedAmount !== existing.estimatedAmount) {
    changes.push('预计金额');
  }
  if (body.notes !== undefined && body.notes !== existing.notes) changes.push('备注');
  await activityLogger.log({
    userId: ctx.userId ?? '',
    username: ctx.username ?? '',
    action: 'OPPORTUNITY_UPDATED',
    module: 'sales',
    businessType: BUSINESS_TYPE.OPPORTUNITY,
    businessId: opportunity.id,
    businessNo: opportunity.opportunityNo,
    summary:
      changes.length > 0
        ? `修改了商机「${body.title || existing.title}」的${changes.join('、')}`
        : `修改了商机「${body.title || existing.title}」`,
    customerId: existing.customerId,
  });

  return opportunity;
}

/**
 * D7 冻结门：商机不是销售来源的拥有者。
 *
 * 请求**即使携带** `channelId` / `shopId` / `leadId`：
 *   - 与当前值一致 → 视为无操作（放行，不产生写入）
 *   - 与当前值不同 → **REJECT**（400），绝不静默改写（避免数据漂移）
 */
function assertStartingFactUnchanged(
  body: OpportunityUpdateInput,
  existing: { leadId: string | null; channelId: string | null; shopId: string | null },
): void {
  if (body.leadId !== undefined && (body.leadId ?? null) !== existing.leadId) {
    throw new DomainValidationError('来源线索不可修改（商机必须依附创建时的销售流程）');
  }
  if (body.channelId !== undefined && (body.channelId ?? null) !== existing.channelId) {
    throw new DomainValidationError('销售流程渠道不可修改（由来源线索的起始渠道决定）');
  }
  if (body.shopId !== undefined && (body.shopId ?? null) !== existing.shopId) {
    throw new DomainValidationError('销售流程平台不可修改（由来源线索的起始平台决定）');
  }
}

// ============================================================
// 删除
// ============================================================

export async function deleteOpportunity(id: string, ctx: SalesActorContext): Promise<void> {
  const existing = await opportunityRepository.findFirst({
    where: (await salesScopedWhere(ctx, id)) as Prisma.OpportunityWhereInput,
    select: { id: true, opportunityNo: true, title: true, customerId: true },
  });
  if (!existing) throw new DomainNotFoundError('记录不存在');

  await opportunityRepository.delete({ where: { id: existing.id } });

  await activityLogger.log({
    userId: ctx.userId ?? '',
    username: ctx.username ?? '',
    action: 'OPPORTUNITY_DELETED',
    module: 'sales',
    businessType: BUSINESS_TYPE.OPPORTUNITY,
    businessId: existing.id,
    businessNo: existing.opportunityNo,
    summary: `删除了商机「${existing.title}」`,
    customerId: existing.customerId,
  });
}

/** 批量删除：scope 条件进入 where ⇒ 越权 id 由 scope 静默排除（部分成功语义） */
export async function batchDeleteOpportunities(ids: string[], ctx: SalesActorContext): Promise<number> {
  const where = applyScope({ id: { in: ids } }, await ctx.scope.owner());
  const result = await opportunityRepository.deleteMany(where as Prisma.OpportunityWhereInput);
  return result.count;
}

// ============================================================
// 【规则冻结】商机不支持 Excel 导入
// ============================================================
//
// 商机不提供批量导入能力：`POST /api/sales/import` 已下线，本层不再提供
// `importOpportunitiesFromBuffer`。商机的唯一来源是「线索转商机」
// （见上方 `createOpportunity`：`leadId` 强前置 + 服务端派生渠道）。
