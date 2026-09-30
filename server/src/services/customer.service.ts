import type { CustomerLevel, IntentLevel, Prisma } from '@prisma/client';
import { z } from 'zod';
import { activityLogger } from '../lib/activity-logger';
import { BUSINESS_TYPE } from '../lib/business-type';
import { DomainConflictError, DomainNotFoundError, DomainValidationError } from '../lib/errors';
import { deriveOpportunityStagesOperation } from '../operations/state.operations';
import type { PipelineStage } from '../state';
import {
  INTENT_LEVEL_ORDER,
  deriveCustomerIntentLevel,
  deriveCustomerIntentLevels,
  withCustomerIntent,
} from '../state';
import { applyScope, includePublicSea, publicSeaScope } from '../scope';
import {
  createCustomerAggregate,
  createImportedCustomer,
  findCustomerByCompanyName,
  findCustomerNameConflict,
  findCustomerScoped,
  findCustomerScopedWithIntent,
  loadAdminCounts,
  loadAssignees,
  loadCustomerDetail,
  loadCustomerEnrichment,
  loadCustomerListPage,
  loadCustomerLogs,
  loadCustomerOptions,
  loadCustomerStats,
  loadDistinctCountries,
  loadListAggregates,
  loadReportStatsData,
  loadSubFilterCounts,
} from '../operations/customer.operations';
import { channelRepository } from '../repositories/channel.repository';
import { customerRepository } from '../repositories/customer.repository';
import { leadRepository } from '../repositories/lead.repository';
import type { DbClient } from '../repositories';
import { userRepository } from '../repositories/user.repository';
import * as XLSX from 'xlsx';

/**
 * Customer Business Layer（Round R-3 · Customer Pilot）
 *
 * 职责：Customer 业务规则、状态规则、意向派生、Lead → Customer 业务语义、
 *       channel/shop 业务不变量、权限感知的业务决策、审计留痕。
 * 约束：不处理 HTTP（无 req / res / 状态码）；业务失败以 `DomainError` 表达；
 *       不直接调用 Prisma（数据访问一律经 repositories / operations）。
 *
 * 【业务基线保持不变】本文件是既有 Controller 内业务逻辑的**搬迁**，
 * 不重新解释任何规则（客户创建/编辑/删除授权、公海语义、渠道契约、
 * 意向读时派生、coverImage 语义、Customer.source 既有写入、Lead → Customer 前端编排路径均逐字沿用）。
 */

// ============================================================
// 上下文
// ============================================================

/** 数据范围提供者（由 Controller 用 scope + req 组装；Business 只调用，不实现权限政策） */
export interface CustomerScopeProvider {
  /** includePublicSea(await roleScope(req))：客户读取边界（owner ∪ 公海 ∪ admin/ALL） */
  customer(): Promise<Record<string, unknown>>;
  /** roleScope(req)：按 ownerId 的默认范围（列表 / 报表 / 下拉共用） */
  owner(): Promise<Record<string, unknown>>;
  /** roleScope(req, { field: 'id' })：目标用户可指派范围 */
  assignee(): Promise<Record<string, unknown>>;
}

export interface CustomerActorContext {
  userId?: string;
  username?: string;
  roleCode?: string;
  /** 报表口径：`roleCode === 'admin' || 'ADMIN'`（沿用既有 getReportStats 判据） */
  isAdmin: boolean;
  /** 归属/编辑/认领授权口径：`roleCode === 'admin'`（**严格小写**，沿用既有各 handler 判据） */
  isStrictAdmin: boolean;
  scope: CustomerScopeProvider;
}

/** 「客户读取边界（id + owner ∪ 公海 ∪ admin/ALL）」条件 */
async function scopedWhere(ctx: CustomerActorContext, id: string): Promise<Prisma.CustomerWhereInput> {
  return applyScope({ id }, await ctx.scope.customer()) as Prisma.CustomerWhereInput;
}

// ============================================================
// DTO 片段（供 Controller 复用；避免 create / update / import 三处重复定义）
// ============================================================

/** 日期解析：Date / 日期字符串 / Excel 序列号 → Date；null 与 '' → null；无法解析 → 'invalid' */
export function parseDateInput(value: unknown): Date | null | 'invalid' {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'invalid' : value;
  if (typeof value === 'number') {
    // Excel 1900 日期系统序列号（如 46265 → 2026-09-14）
    if (!Number.isFinite(value) || value <= 0 || value > 60000) return 'invalid';
    return new Date(Date.UTC(1899, 11, 30) + value * 86400000);
  }
  if (typeof value === 'string') {
    const parsed = new Date(value.trim());
    return Number.isNaN(parsed.getTime()) ? 'invalid' : parsed;
  }
  return 'invalid';
}

/** 日期字段：未传 → undefined（保持原值）；null / '' → null（清空）；解析失败 → 400 */
export const dateField = z
  .union([z.string(), z.number(), z.date(), z.null()])
  .optional()
  .refine((value) => value === undefined || parseDateInput(value) !== 'invalid', {
    message: '日期格式不正确',
  })
  .transform((value) => (value === undefined ? undefined : (parseDateInput(value) as Date | null)));

// ============================================================
// Business helpers
// ============================================================

/** 主图归一：coverImage 优先，images 仅作兼容输入；两者都不会同时写入（coverImage = 客户名片） */
export function normalizeCoverImage(input: { coverImage?: unknown; images?: unknown }): string | null | undefined {
  const pick = (value: unknown): string | null | undefined => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (Array.isArray(value)) {
      const first = value.find((item) => typeof item === 'string' && item.trim().length > 0);
      return typeof first === 'string' ? first.trim() : null;
    }
    if (typeof value === 'string') return value.trim() || null;
    return undefined;
  };
  const fromCoverImage = pick(input.coverImage);
  return fromCoverImage !== undefined ? fromCoverImage : pick(input.images);
}

/** tags 语义比较（顺序无关，均为 string[]） */
export function sameTags(a: string[], b: string[] | null | undefined): boolean {
  const left = [...a].sort();
  const right = [...(b ?? [])].sort();
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

/**
 * 渠道/平台契约校验（存在 + ACTIVE + 父子一致性 `shop.parentId === channelId`）。
 * Channel 属全局主数据（无 per-user 权限机制），故仅做引用合法性；不发明第二套 Channel 权限体系。
 */
async function assertChannelShop(
  channelId: string | null | undefined,
  shopId: string | null | undefined,
): Promise<void> {
  if (channelId) {
    const ch = await channelRepository.findStatusById(channelId);
    if (!ch || ch.status !== 'ACTIVE') throw new DomainValidationError('来源渠道不存在');
  }
  if (shopId) {
    const shop = await channelRepository.findStatusWithParentById(shopId);
    if (!shop || shop.status !== 'ACTIVE') throw new DomainValidationError('来源平台不存在');
    if (channelId && shop.parentId !== channelId) {
      throw new DomainValidationError('来源平台不属于所选来源渠道');
    }
  }
}

/** 拆分组合来源值（sourceKey = JSON `{channelId, shopId}`），解析失败回退显式值 */
function splitSourceKey(raw?: string | null): { channelId?: string | null; shopId?: string | null } {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as { channelId?: string; shopId?: string };
    if (parsed && typeof parsed === 'object') {
      return { channelId: parsed.channelId ?? null, shopId: parsed.shopId ?? null };
    }
  } catch {
    /* 非 JSON 则忽略，回退到显式 channelId/shopId */
  }
  return {};
}

/**
 * ownership mutation 授权（create / update 共用）：
 * 显式非空 ownerId 必须「存在 + ACTIVE + ∈ caller dataScope」，且先于任何写入。
 * `null`（公海）/ `undefined`（不改）不触发校验。
 */
async function assertAssignableOwner(ownerId: string | null | undefined, ctx: CustomerActorContext): Promise<void> {
  if (ownerId === undefined || ownerId === null) return;
  const targetOwner = await userRepository.findScopedTransferTarget(ownerId, await ctx.scope.assignee());
  if (!targetOwner) throw new DomainValidationError('业务归属人不存在或无权限指派');
  if (targetOwner.status !== 'ACTIVE') throw new DomainValidationError('目标用户不存在或已停用');
}

/** 编辑/删除/认领/释放/转交的 actor 门（owner | admin）；不可操作时与不存在同响应（不泄露存在性） */
function assertActorOwns(existingOwnerId: string | null, ctx: CustomerActorContext): void {
  if (existingOwnerId !== ctx.userId && !ctx.isStrictAdmin) {
    throw new DomainNotFoundError('客户不存在');
  }
}

/**
 * intentBreakdown（D-INTENT v2）：保持既有稀疏结构 `[{ level, count }]`（仅 count > 0，顺序 = 业务等级由低到高），
 * 末位「无意向」条目 level 为 `null`。数据来源为**派生计数**（商机意向聚合），不读取 legacy 列。
 */
function buildIntentBreakdown(
  counts: Map<IntentLevel, number>,
  noIntentCount: number,
): { level: IntentLevel | null; count: number }[] {
  const rows: { level: IntentLevel | null; count: number }[] = INTENT_LEVEL_ORDER.map((level) => ({
    level: level as IntentLevel | null,
    count: counts.get(level) ?? 0,
  })).filter((row) => row.count > 0);
  if (noIntentCount > 0) rows.push({ level: null, count: noIntentCount });
  return rows;
}

// ============================================================
// 用例：列表 / 详情 / 选项
// ============================================================

export interface CustomerListInput {
  keyword?: string;
  type?: string;
  country?: string;
  page?: string | number;
  pageSize?: string | number;
  ownerId?: string;
}

/** 我的私海客户列表（含统计 / 子筛选计数 / 全量聚合 / enrichment） */
export async function listMy(input: CustomerListInput, ctx: CustomerActorContext) {
  const userId = ctx.userId!;
  const page = input.page ?? '1';
  const pageSize = input.pageSize ?? '20';
  const skip = (Number(page) - 1) * Number(pageSize);
  const take = Number(pageSize);
  const year = new Date().getFullYear();

  // 数据范围：公海视图仅无负责人客户；其余视图 = 范围数据 + 公海（公海对集团开放）
  const isPublic = input.type === 'public';
  const scope = isPublic ? publicSeaScope() : includePublicSea(await ctx.scope.customer());
  const andConditions: Prisma.CustomerWhereInput[] = scope && Object.keys(scope).length > 0 ? [scope as Prisma.CustomerWhereInput] : [];

  if (input.keyword) {
    andConditions.push({
      OR: [
        { companyName: { contains: String(input.keyword) } },
        { contactName: { contains: String(input.keyword) } },
        { email: { contains: String(input.keyword) } },
        { phone: { contains: String(input.keyword) } },
      ],
    });
  }
  if (input.country) andConditions.push({ country: String(input.country) });
  andConditions.push(...typeConditions(input.type, year));

  const where: Prisma.CustomerWhereInput = { AND: andConditions };

  const [pageResult, statsRaw, subFilterCounts] = await Promise.all([
    loadCustomerListPage({
      where,
      skip,
      take,
      include: {
        owner: { select: { id: true, username: true, realName: true, role: { select: { code: true } } } },
        _count: { select: { salesOrders: true, opportunities: true } },
        opportunities: { select: { intentLevel: true } },
      },
    }),
    loadCustomerStats({ where: statsWhere(userId), totalWhere: statsTotalWhere(userId), year }),
    loadSubFilterCounts({ ownerId: userId }),
  ]);

  const aggregates = await loadListAggregates({
    customerWhere: where,
    customerAnd: andConditions,
    year,
  });

  const { orderAgg, pipelineAgg } = await loadCustomerEnrichment(pageResult.list.map((c) => c.id));
  const orderMap = toOrderAggMap(orderAgg);
  const pipelineMap = toPipelineAggMap(pipelineAgg);
  const enriched = pageResult.list.map((c) =>
    // D-INTENT v2：intentLevel 以商机最高意向**派生值**覆盖（不读 legacy 存储列）
    withCustomerIntent({
      ...c,
      totalAmount: orderMap[c.id]?.totalAmount || 0,
      lastOrderDate: orderMap[c.id]?.lastOrderDate || null,
      pipelineAmount: pipelineMap[c.id]?.pipelineAmount || 0,
    }),
  );

  return {
    list: enriched,
    total: pageResult.total,
    page: Number(page),
    pageSize: take,
    stats: {
      total: statsRaw.total,
      newCount: statsRaw.newCount,
      oldCount: statsRaw.oldCount,
      noOrderCount: statsRaw.noOrderCount,
      keyCount: statsRaw.keyCount,
      intentBreakdown: buildIntentBreakdown(deriveCounts(statsRaw.intentGroups), statsRaw.noIntentCount),
    },
    ...subFilterCounts,
    estimatedAmount: aggregates.estimatedAgg._sum.estimatedAmount || 0,
    totalContractAmount: Number(aggregates.totalAmountAgg._sum.totalAmountCny ?? 0),
    estimatedBreakdown: aggregates.estimatedBreakdown,
    contractBreakdown: [
      { type: '新客户', amount: Number(aggregates.newAmountAgg._sum.totalAmountCny ?? 0) },
      { type: '老客户', amount: Number(aggregates.oldAmountAgg._sum.totalAmountCny ?? 0) },
    ],
  };
}

/** 公海客户列表 */
export async function listPublic(input: CustomerListInput, ctx: CustomerActorContext) {
  const page = input.page ?? '1';
  const take = Number(input.pageSize ?? '20');
  const skip = (Number(page) - 1) * take;

  const publicOwnerFilter = [{ ownerId: null }];
  let where: Prisma.CustomerWhereInput;
  if (input.keyword) {
    const keywordFilter = [
      { companyName: { contains: String(input.keyword) } },
      { contactName: { contains: String(input.keyword) } },
      { country: { contains: String(input.keyword) } },
    ];
    where = { AND: [{ OR: publicOwnerFilter }, { OR: keywordFilter }] };
  } else {
    where = { OR: publicOwnerFilter };
  }
  if (input.country) where.country = String(input.country);

  const pageResult = await loadCustomerListPage({
    where,
    skip,
    take,
    include: {
      owner: { select: { id: true, username: true, realName: true, role: { select: { code: true } } } },
      _count: { select: { salesOrders: true } },
      opportunities: { select: { intentLevel: true } },
    },
  });

  const { orderAgg } = await loadCustomerEnrichment(pageResult.list.map((c) => c.id));
  const orderMap = toOrderAggMap(orderAgg);
  const enriched = pageResult.list.map((c) =>
    withCustomerIntent({
      ...c,
      totalAmount: orderMap[c.id]?.totalAmount || 0,
      lastOrderDate: orderMap[c.id]?.lastOrderDate || null,
    }),
  );

  return { list: enriched, total: pageResult.total, page: Number(page), pageSize: take };
}

/**
 * 轻量归属查询（线索表单 onBlur 去重 / 归属判定专用）。
 * 跨全员检索（刻意**不套**数据范围），仅返回归属状态码 + 命中主键 + 负责人姓名。
 */
export async function checkOwnership(companyName: string | undefined, ctx: CustomerActorContext) {
  const name = companyName?.trim();
  if (!name) throw new DomainValidationError('companyName required');

  const hit = await findCustomerByCompanyName(name);
  if (!hit) return { code: 'NOT_FOUND' as const };

  let code: 'OWNED_BY_ME' | 'OWNED_BY_OTHER' | 'IN_PUBLIC_SEA';
  let ownerName: string | undefined;
  if (!hit.ownerId) {
    code = 'IN_PUBLIC_SEA';
  } else if (hit.ownerId === ctx.userId) {
    code = 'OWNED_BY_ME';
  } else {
    code = 'OWNED_BY_OTHER';
    ownerName = hit.owner?.realName || hit.owner?.username;
  }
  return { code, customerId: hit.id, ownerName };
}

/** 客户下拉选项：我的私海 + 公海；管理员为全部 */
export async function listOptions(ctx: CustomerActorContext) {
  return loadCustomerOptions((await ctx.scope.owner()) as Prisma.CustomerWhereInput);
}

/** 管理员：查看所有客户（按业务员分组 + 公海统计 + 全库统计 + 全量聚合） */
export async function listAll(input: CustomerListInput, ctx: CustomerActorContext) {
  const page = input.page ?? '1';
  const take = Number(input.pageSize ?? '20');
  const skip = (Number(page) - 1) * take;
  const year = new Date().getFullYear();

  const andConditions: Prisma.CustomerWhereInput[] = [];
  if (input.keyword) {
    andConditions.push({
      OR: [
        { companyName: { contains: String(input.keyword) } },
        { contactName: { contains: String(input.keyword) } },
      ],
    });
  }
  if (input.country) andConditions.push({ country: String(input.country) });

  if (input.type === 'public') {
    andConditions.push({ ownerId: null });
  } else if (input.ownerId) {
    andConditions.push({ ownerId: String(input.ownerId) });
  } else {
    andConditions.push({ ownerId: { not: null } });
  }
  andConditions.push(...typeConditions(input.type, year));

  const where: Prisma.CustomerWhereInput = andConditions.length > 0 ? { AND: andConditions } : {};
  const listAllScope: Prisma.CustomerWhereInput = input.ownerId
    ? { ownerId: String(input.ownerId) }
    : { ownerId: { not: null } };

  const [pageResult, assignees, subFilterCounts] = await Promise.all([
    loadCustomerListPage({
      where,
      skip,
      take,
      include: {
        owner: { select: { id: true, username: true, realName: true, role: { select: { code: true } } } },
        _count: { select: { salesOrders: true, opportunities: true } },
        opportunities: { select: { intentLevel: true } },
      },
    }),
    loadAssignees(),
    loadSubFilterCounts(listAllScope),
  ]);

  const aggregates = await loadListAggregates({
    customerWhere: where,
    customerAnd: andConditions,
    year,
  });

  const { orderAgg, pipelineAgg } = await loadCustomerEnrichment(pageResult.list.map((c) => c.id));
  const orderMap = toOrderAggMap(orderAgg);
  const pipelineMap = toPipelineAggMap(pipelineAgg);
  const enriched = pageResult.list.map((c) =>
    withCustomerIntent({
      ...c,
      totalAmount: orderMap[c.id]?.totalAmount || 0,
      lastOrderDate: orderMap[c.id]?.lastOrderDate || null,
      pipelineAmount: pipelineMap[c.id]?.pipelineAmount || 0,
    }),
  );

  const ownerStats = assignees.map((u) => ({
    id: u.id,
    username: u.username,
    realName: u.realName,
    customerCount: u._count.ownedCustomers,
    keyCount: u.ownedCustomers.length,
  }));

  const counts = await loadAdminCounts(year);

  return {
    list: enriched,
    total: pageResult.total,
    page: Number(page),
    pageSize: take,
    ownerStats,
    publicCount: counts.publicCount,
    ...subFilterCounts,
    stats: { total: counts.totalAll, newCount: counts.newAll, oldCount: counts.oldAll, keyCount: counts.keyAll },
    estimatedAmount: aggregates.estimatedAgg._sum.estimatedAmount || 0,
    totalContractAmount: Number(aggregates.totalAmountAgg._sum.totalAmountCny ?? 0),
    estimatedBreakdown: aggregates.estimatedBreakdown,
    contractBreakdown: [
      { type: '新客户', amount: Number(aggregates.newAmountAgg._sum.totalAmountCny ?? 0) },
      { type: '老客户', amount: Number(aggregates.oldAmountAgg._sum.totalAmountCny ?? 0) },
    ],
  };
}

/** 客户详情（含订单 / 商机 / 线索；响应 intentLevel 为派生值） */
export async function getById(id: string, ctx: CustomerActorContext) {
  const customer = await loadCustomerDetail(await scopedWhere(ctx, id));
  if (!customer) throw new DomainNotFoundError('客户不存在');
  return withCustomerIntent(customer);
}

// ============================================================
// 用例：创建 / 更新 / 删除 / 标签
// ============================================================

export interface CreateCustomerInput {
  companyName: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
  industry?: string | null;
  website?: string | null;
  customerType?: string | null;
  sourceKey?: string | null;
  channelId?: string | null;
  shopId?: string | null;
  contactMethods?: unknown;
  notes?: string | null;
  ownerId?: string | null;
  isKeyAccount?: boolean;
  tags?: string[];
  coverImage?: unknown;
  images?: unknown;
}

/** 创建客户（含去重 409 / 归属授权 / 渠道契约；编号与写入同事务） */
export async function create(
  input: CreateCustomerInput,
  ctx: CustomerActorContext,
  db?: DbClient,
) {
  const userId = ctx.userId!;
  const username = ctx.username!;

  // F-CRM-CHANNEL：来源拆分（sourceKey 优先于显式 channelId/shopId），并校验引用合法性
  const fromSourceKey = splitSourceKey(input.sourceKey);
  const channelId = fromSourceKey.channelId !== undefined ? fromSourceKey.channelId : (input.channelId ?? null);
  const shopId = fromSourceKey.shopId !== undefined ? fromSourceKey.shopId : (input.shopId ?? null);
  await assertChannelShop(channelId, shopId);

  // ownerId 传入 null → 公海；未传入 → 归当前用户
  const finalOwnerId: string | null = input.ownerId !== undefined ? input.ownerId : userId;
  await assertAssignableOwner(input.ownerId, ctx);

  // 客户唯一性检测（去重）：全库精确匹配（与 /ownership 一致）
  const existed = await findCustomerNameConflict(input.companyName);
  if (existed) {
    throw new DomainConflictError(`客户已存在（公司名称重复）：${existed.companyName}`);
  }

  const customer = await createCustomerAggregate(
    {
      companyName: input.companyName,
      contactName: input.contactName ?? null,
      industry: input.industry ?? null,
      website: input.website ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      country: input.country ?? null,
      customerType: input.customerType ?? null,
      channelId: channelId ?? null,
      shopId: shopId ?? null,
      contactMethods: (input.contactMethods ?? null) as Prisma.InputJsonValue | undefined,
      coverImage: normalizeCoverImage(input) ?? null,
      // D-SOURCE-2：手工创建由 API 业务语义固定为 MANUAL（既有写入，本轮逐字沿用；是否废弃为独立决策）
      source: 'MANUAL',
      notes: input.notes ?? null,
      ownerId: finalOwnerId,
      isKeyAccount: input.isKeyAccount ?? false,
      tags: input.tags ?? [],
      // D-INTENT v2：intentLevel 由商机读时派生 ⇒ 创建时不写入
    },
    // V1.1：线索建档传入外部事务客户端（跨聚合单事务）；其余调用不传，保持自开事务
    db,
  );

  await activityLogger.log({
    userId,
    username,
    action: 'CREATED',
    module: 'customer',
    businessType: BUSINESS_TYPE.CUSTOMER,
    businessId: customer.id,
    businessNo: customer.customerNo,
    summary: `创建客户：${input.companyName}`,
    customerId: customer.id,
  });

  // D-INTENT v2：新建客户必然没有关联商机 ⇒ 派生意向为 null（确定性结果，不额外查询）
  return { ...customer, intentLevel: null };
}

export interface UpdateCustomerInput {
  companyName?: string;
  englishName?: string | null;
  industry?: string | null;
  website?: string | null;
  contactName?: string | null;
  position?: string | null;
  email?: string | null;
  phone?: string | null;
  wechat?: string | null;
  country?: string | null;
  region?: string | null;
  customerLevel?: CustomerLevel;
  customerType?: string | null;
  sourceKey?: string | null;
  channelId?: string | null;
  shopId?: string | null;
  contactMethods?: unknown;
  notes?: string | null;
  ownerId?: string | null;
  isKeyAccount?: boolean;
  tags?: string[];
  firstOrderAt?: Date | null;
  firstOrderDate?: Date | null;
  coverImage?: unknown;
  images?: unknown;
}

/** 更新客户（数据范围门 → actor 门 → 归属授权 → 渠道契约 → 单次写入 → 审计） */
export async function update(id: string, body: UpdateCustomerInput, ctx: CustomerActorContext) {
  const userId = ctx.userId!;
  const username = ctx.username!;

  const {
    companyName, contactName, englishName, industry, website, position, email, phone, wechat,
    country, region, customerLevel, customerType, notes, ownerId, isKeyAccount, tags,
  } = body;

  const coverImage = normalizeCoverImage(body);
  // 首次下单日期：firstOrderAt（V1.0）优先，兼容旧入参别名；内部只写 firstOrderAt
  const firstOrderAt = body.firstOrderAt !== undefined ? body.firstOrderAt : body.firstOrderDate;

  // BC-8-2（DQ-8-C）：目标客户必须落在调用方客户可见范围（owner ∪ 公海 ∪ admin/ALL）
  // D-INTENT v2：复用既有查询附带商机意向投影（不新增查询）
  const existing = await findCustomerScopedWithIntent(await scopedWhere(ctx, id));
  if (!existing) throw new DomainNotFoundError('客户不存在');
  assertActorOwns(existing.ownerId, ctx);

  await assertAssignableOwner(ownerId, ctx);

  const changes: string[] = [];
  if (companyName && companyName !== existing.companyName) changes.push(`公司名: ${existing.companyName} → ${companyName}`);
  if (isKeyAccount !== undefined && isKeyAccount !== existing.isKeyAccount) {
    changes.push(`${existing.isKeyAccount ? '取消重点' : '标记为重点'}客户`);
  }
  // D-INTENT v2：Customer.intentLevel 已非人工字段 ⇒ 不再记录「意向等级变更」日志
  if (tags !== undefined && !sameTags(tags, existing.tags)) changes.push('标签已更新');

  // ---- 来源渠道（V1.1 调整）：客户来源**可编辑**，且为客户唯一权威 ----
  //
  // 规则：一个客户只有一种来源。
  //   · 客户编辑接口**采信** `sourceKey`（优先）/ `channelId`+`shopId`；
  //   · 未提供来源 → 沿用既有值（不因未传而清空）；
  //   · 来源发生变化 → 写入客户，并**级联同步该客户名下线索的来源**（线索来源恒等于客户来源）。
  //
  // 变更说明：原「建档后不可覆盖」的冻结口径按业务要求放开为可编辑；
  // 校验（渠道存在 / 父子一致性）与写入事务保持不变。
  const fromSourceKey = splitSourceKey(body.sourceKey);
  const reqChannelId =
    fromSourceKey.channelId !== undefined ? fromSourceKey.channelId : (body.channelId ?? undefined);
  const reqShopId =
    fromSourceKey.shopId !== undefined ? fromSourceKey.shopId : (body.shopId ?? undefined);
  const sourceProvided = reqChannelId !== undefined || reqShopId !== undefined;
  let effChannelId = existing.channelId;
  let effShopId = existing.shopId;
  let sourceChanged = false;
  if (sourceProvided) {
    const nextChannelId = reqChannelId ?? null;
    const nextShopId = reqShopId ?? null;
    await assertChannelShop(nextChannelId, nextShopId);
    if (nextChannelId !== existing.channelId || nextShopId !== existing.shopId) {
      effChannelId = nextChannelId;
      effShopId = nextShopId;
      sourceChanged = true;
    }
  } else {
    await assertChannelShop(effChannelId ?? null, effShopId ?? null);
  }

  const customer = await customerRepository.update({
    where: { id },
    data: {
      // V1.0：仅写入 Customer 标量；未传字段（undefined）不出现在 data 中 → 保持原值
      ...(companyName !== undefined ? { companyName } : {}),
      ...(contactName !== undefined ? { contactName } : {}),
      ...(englishName !== undefined ? { englishName } : {}),
      ...(industry !== undefined ? { industry } : {}),
      ...(website !== undefined ? { website } : {}),
      ...(position !== undefined ? { position } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(phone !== undefined ? { phone } : {}),
      ...(wechat !== undefined ? { wechat } : {}),
      ...(country !== undefined ? { country } : {}),
      ...(region !== undefined ? { region } : {}),
      ...(coverImage !== undefined ? { coverImage } : {}),
      ...(customerLevel !== undefined ? { customerLevel } : {}),
      ...(customerType !== undefined ? { customerType } : {}),
      channelId: effChannelId ?? null,
      shopId: effShopId ?? null,
      ...(body.contactMethods !== undefined
        ? { contactMethods: (body.contactMethods ?? null) as Prisma.InputJsonValue | undefined }
        : {}),
      // D-SOURCE-4：普通 update 不写 source（既有规则，本轮逐字沿用）
      ...(notes !== undefined ? { notes } : {}),
      ...(ownerId !== undefined ? { ownerId } : {}),
      ...(isKeyAccount !== undefined ? { isKeyAccount } : {}),
      ...(tags !== undefined ? { tags } : {}),
      ...(firstOrderAt !== undefined ? { firstOrderAt } : {}),
    },
  });

  // 来源不变量级联：客户来源变更后，其名下线索来源同步跟随
  // （一个客户只有一种来源：客户是权威，线索恒取客户来源）
  if (sourceChanged) {
    await leadRepository.updateSourceByCustomerId(id, effChannelId ?? null, effShopId ?? null);
  }

  if (changes.length > 0) {
    await activityLogger.log({
      userId,
      username,
      action: 'UPDATED',
      module: 'customer',
      businessType: BUSINESS_TYPE.CUSTOMER,
      businessId: id,
      businessNo: customer.customerNo,
      summary: changes.join('；'),
      customerId: id,
    });
  }

  // D-INTENT v2：响应 intentLevel 为派生值（本用例不修改商机集合，故复用已读取的 opportunities）
  return { ...customer, intentLevel: deriveCustomerIntentLevel(existing.opportunities) };
}

/** 删除客户（仅归属人或管理员可达；不可操作时与不存在同响应） */
export async function remove(id: string, ctx: CustomerActorContext): Promise<void> {
  const existing = await customerRepository.findFirst({ where: await scopedWhere(ctx, id) });
  if (!existing) throw new DomainNotFoundError('客户不存在');
  assertActorOwns(existing.ownerId, ctx);

  await customerRepository.delete({ where: { id } });
}

/** 更新客户标签 */
export async function updateTags(id: string, tags: string[], ctx: CustomerActorContext) {
  const userId = ctx.userId!;
  const username = ctx.username!;

  const existing = await findCustomerScopedWithIntent(await scopedWhere(ctx, id));
  if (!existing) throw new DomainNotFoundError('客户不存在');
  assertActorOwns(existing.ownerId, ctx);

  const customer = await customerRepository.update({ where: { id }, data: { tags } });

  if (!sameTags(tags, existing.tags)) {
    await activityLogger.log({
      userId,
      username,
      action: 'UPDATED',
      module: 'customer',
      businessType: BUSINESS_TYPE.CUSTOMER,
      businessId: id,
      businessNo: customer.customerNo,
      summary: '更新客户标签',
      customerId: id,
    });
  }

  return { ...customer, intentLevel: deriveCustomerIntentLevel(existing.opportunities) };
}

// ============================================================
// 用例：公海认领 / 释放 / 转交
// ============================================================

/** 认领客户（公海 → 私海） */
export async function claim(id: string, ctx: CustomerActorContext): Promise<void> {
  const userId = ctx.userId!;
  const username = ctx.username!;

  const customer = await customerRepository.findFirst({ where: await scopedWhere(ctx, id) });
  if (!customer) throw new DomainNotFoundError('客户不存在');
  // 公海客户：仅 ownerId 为 null
  if (customer.ownerId) throw new DomainValidationError('该客户已被认领');

  await customerRepository.update({ where: { id }, data: { ownerId: userId } });

  await activityLogger.log({
    userId,
    username,
    action: 'CLAIM',
    module: 'customer',
    businessType: BUSINESS_TYPE.CUSTOMER,
    businessId: id,
    businessNo: customer.customerNo,
    summary: `${username} 认领了该客户`,
    customerId: id,
  });
}

/** 释放客户（私海 → 公海） */
export async function release(id: string, ctx: CustomerActorContext): Promise<void> {
  const userId = ctx.userId!;
  const username = ctx.username!;

  const customer = await customerRepository.findFirst({ where: await scopedWhere(ctx, id) });
  if (!customer) throw new DomainNotFoundError('客户不存在');
  if (!customer.ownerId) throw new DomainValidationError('该客户已在公海');
  assertActorOwns(customer.ownerId, ctx);

  await customerRepository.update({ where: { id }, data: { ownerId: null, isKeyAccount: false } });

  await activityLogger.log({
    userId,
    username,
    action: 'RELEASE',
    module: 'customer',
    businessType: BUSINESS_TYPE.CUSTOMER,
    businessId: id,
    businessNo: customer.customerNo,
    summary: `${username} 释放该客户到公海`,
    customerId: id,
  });
}

/** 转交客户（owner | admin；目标用户需存在 + ACTIVE + ∈ caller dataScope） */
export async function transfer(id: string, newOwnerId: string | undefined, ctx: CustomerActorContext): Promise<void> {
  const userId = ctx.userId!;
  const username = ctx.username!;

  const customer = await customerRepository.findFirst({
    where: await scopedWhere(ctx, id),
    include: { owner: { select: { id: true, realName: true } } },
  });
  if (!customer) throw new DomainNotFoundError('客户不存在');
  // actor gate = owner | admin（3C-8-1a 裁定，保持不变）
  assertActorOwns(customer.ownerId, ctx);

  if (!newOwnerId) throw new DomainValidationError('请选择新负责人');

  // BC-8-1（DQ-8-A）：目标用户必须 存在 + ACTIVE + ∈ caller dataScope
  const newOwner = await userRepository.findScopedTransferTarget(newOwnerId, await ctx.scope.assignee());
  if (!newOwner) throw new DomainValidationError('业务归属人不存在或无权限指派');
  if (newOwner.status !== 'ACTIVE') throw new DomainValidationError('目标用户不存在或已停用');

  const oldOwnerName = customer.owner?.realName || '未分配';

  await customerRepository.update({ where: { id }, data: { ownerId: newOwnerId } });

  await activityLogger.log({
    userId,
    username,
    action: 'TRANSFERRED',
    module: 'customer',
    businessType: BUSINESS_TYPE.CUSTOMER,
    businessId: id,
    businessNo: customer.customerNo,
    summary: `${username} 将客户从「${oldOwnerName}」转交给「${newOwner.realName || newOwner.username}」`,
    customerId: id,
  });
}

// ============================================================
// 用例：Excel 导入 / 国家 / 报表 / 操作记录
// ============================================================

/** Excel 导入逐行校验（非法 enum / 日期 → 该行失败并计入 failed，不产生 500） */
const customerImportSchema = z.object({
  companyName: z.string().trim().min(1, '公司名称不能为空'),
  contactName: z.string().trim().max(100).nullish(),
  email: z.string().trim().max(200).nullish(),
  phone: z.string().trim().max(50).nullish(),
  country: z.string().trim().max(100).nullish(),
  // D-SOURCE-3：Excel「来源 / source」映射已移除（source 不再由 Excel 决定）
  notes: z.string().trim().max(2000).nullish(),
  isKeyAccount: z.boolean().optional(),
  // D-INTENT v2：intentLevel 为系统派生字段 ⇒ 不接受该列
  firstOrderAt: dateField,
});

/**
 * Excel 批量导入客户。
 * - 逐行独立事务 ⇒ 保留既有「部分成功」语义；
 * - 导入客户默认进公海（ownerId=null）；
 * - `source` 由 API 业务语义固定为 EXCEL（既有写入，本轮逐字沿用）。
 */
export async function importExcel(buffer: Buffer): Promise<{ created: number; failed: number }> {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet);

  const fieldMap: Record<string, string> = {
    公司名称: 'companyName',
    公司名: 'companyName',
    company: 'companyName',
    联系人: 'contactName',
    contact: 'contactName',
    邮箱: 'email',
    email: 'email',
    电话: 'phone',
    phone: 'phone',
    国家: 'country',
    country: 'country',
    // D-SOURCE-3：移除 Excel「来源 / source」映射
    备注: 'notes',
    notes: 'notes',
    重点客户: 'isKeyAccount',
    // D-INTENT v2：移除 Excel「意向等级」导入映射
    首次下单日期: 'firstOrderAt',
  };

  let created = 0;
  let failed = 0;

  for (const row of rows) {
    const raw: Record<string, unknown> = { source: 'EXCEL' };
    for (const [key, value] of Object.entries(row)) {
      const mapped = fieldMap[key] || fieldMap[key.toLowerCase()] || null;
      if (mapped) {
        if (mapped === 'isKeyAccount') {
          raw[mapped] = ['是', 'yes', 'true', '1'].includes(String(value).toLowerCase());
        } else {
          raw[mapped] = value;
        }
      }
    }
    const parsedRow = customerImportSchema.safeParse(raw);
    if (!parsedRow.success) {
      failed++;
      continue;
    }

    try {
      await createImportedCustomer({
        companyName: parsedRow.data.companyName,
        contactName: parsedRow.data.contactName ?? null,
        email: parsedRow.data.email ?? null,
        phone: parsedRow.data.phone ?? null,
        country: parsedRow.data.country ?? null,
        // D-SOURCE-3：导入客户由 API 业务语义固定为 EXCEL（既有写入，逐字沿用）
        source: 'EXCEL',
        notes: parsedRow.data.notes ?? null,
        ownerId: null, // V1.0：导入客户默认进公海
        isKeyAccount: parsedRow.data.isKeyAccount ?? false,
        firstOrderAt: parsedRow.data.firstOrderAt ?? null,
      });
      created++;
    } catch {
      failed++;
    }
  }

  return { created, failed };
}

/** 国家列表 */
export function getCountries() {
  return loadDistinctCountries();
}

/**
 * 报表统计：商机漏斗 / 打样 / 出货 / 新老客户 / 转化率。
 * 阶段为**派生值**（state/pipelineStage.state.ts 纯规则 + operations/state.operations.ts 装载），不落库。
 */
export async function getReportStats(ctx: CustomerActorContext) {
  const isAdmin = ctx.isAdmin;
  // 销售管道权限：按角色数据范围过滤（含公海）
  const opportunityWhere: Prisma.OpportunityWhereInput = isAdmin
    ? {}
    : ((await ctx.scope.owner()) as Prisma.OpportunityWhereInput);
  // 客户权限：按角色数据范围过滤（统计口径不含公海）
  const customerWhere: Prisma.CustomerWhereInput = isAdmin
    ? {}
    : ((await ctx.scope.owner()) as Prisma.CustomerWhereInput);

  const year = new Date().getFullYear();
  const raw = await loadReportStatsData({ opportunityWhere, customerWhere, year });

  const newCustomerAmount = raw.newCustomerOrders.reduce((s, o) => s + Number(o.totalAmountCny ?? 0), 0);
  const oldCustomerAmount = raw.oldCustomerOrders.reduce((s, o) => s + Number(o.totalAmountCny ?? 0), 0);

  // 按派生阶段统计商机数量
  const stageMap = await deriveOpportunityStagesOperation(raw.allOpportunities);
  const stageCount = (s: PipelineStage) => [...stageMap.values()].filter((v) => v === s).length;
  const opportunityCount = stageCount('OPPORTUNITY');
  const pipelineOrderCount = stageCount('ORDER') + stageCount('SHIPPED');
  const leadCount = stageCount('LEAD') + opportunityCount + pipelineOrderCount;

  // 转化率
  const leadToOpportunity = leadCount > 0 ? Math.round((opportunityCount / leadCount) * 100) : 0;
  const opportunityToNext =
    opportunityCount > 0
      ? Math.round(((raw.sampleOrderCount + pipelineOrderCount) / opportunityCount) * 100)
      : 0;
  const sampleToOrder =
    raw.sampleOrderCount > 0 ? Math.round((raw.shippedOrderCount / raw.sampleOrderCount) * 100) : 0;
  const leadToOrder = leadCount > 0 ? Math.round((pipelineOrderCount / leadCount) * 100) : 0;

  return {
    leadCount,
    opportunityCount,
    sampleOrderCount: raw.sampleOrderCount,
    pipelineOrderCount,
    newCustomerCount: raw.newCustomerCount,
    oldCustomerCount: raw.oldCustomerCount,
    newCustomerAmount,
    oldCustomerAmount,
    leadToOpportunity,
    opportunityToNext,
    sampleToOrder,
    leadToOrder,
  };
}

/**
 * 客户操作记录（详情「跟进动态」Tab）。
 * 客户不可见 ⇒ 返回 `{ code: 'NOT_FOUND' }`（**既有契约**：200 + code，不是 404）。
 */
export async function getCustomerLogs(id: string, ctx: CustomerActorContext) {
  const customer = await findCustomerScoped(await scopedWhere(ctx, id));
  if (!customer) return { code: 'NOT_FOUND' as const };
  return { list: await loadCustomerLogs(customer.id) };
}

// ============================================================
// 内部：where / 聚合映射
// ============================================================

/** type 筛选条件（与既有 listMy / listAll 逐条一致；两处共用同一实现，口径完全一致） */
function typeConditions(type: string | undefined, year: number): Prisma.CustomerWhereInput[] {
  if (type === 'key') return [{ isKeyAccount: true }];
  if (type === 'noOrder') return [{ salesOrders: { none: {} } }];
  if (type === 'noOrder-none') {
    return [{ salesOrders: { none: {} }, opportunities: { none: {} } }];
  }
  if (type === 'noOrder-A') {
    return [{ salesOrders: { none: {} }, opportunities: { some: { intentLevel: 'READY' } } }];
  }
  if (type === 'noOrder-B') {
    return [
      {
        salesOrders: { none: {} },
        AND: [
          { opportunities: { some: { intentLevel: 'HIGH' } } },
          { opportunities: { none: { intentLevel: 'READY' } } },
        ],
      },
    ];
  }
  if (type === 'noOrder-C') {
    return [
      {
        salesOrders: { none: {} },
        AND: [
          { opportunities: { some: { intentLevel: 'MEDIUM' } } },
          { opportunities: { none: { intentLevel: 'READY' } } },
          { opportunities: { none: { intentLevel: 'HIGH' } } },
        ],
      },
    ];
  }
  if (type === 'noOrder-D') {
    // 低意向：未成交 + 有商机记录 + 非 A/B/C 意向（排除待开发客户）
    return [
      {
        salesOrders: { none: {} },
        opportunities: { some: {} },
        AND: [
          { opportunities: { none: { intentLevel: 'READY' } } },
          { opportunities: { none: { intentLevel: 'HIGH' } } },
          { opportunities: { none: { intentLevel: 'MEDIUM' } } },
        ],
      },
    ];
  }
  if (type === 'done') return [{ salesOrders: { some: {} } }];
  if (type === 'done-new') {
    return [{ salesOrders: { some: {} }, firstOrderAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } }];
  }
  if (type === 'done-old') {
    return [
      {
        salesOrders: { some: {} },
        firstOrderAt: { not: null, lt: new Date(year, 0, 1) },
      },
    ];
  }
  return [];
}

/** 统计口径的 where（管理员视图排除公海；ownerId 存在时按归属人） */
function statsWhere(ownerId?: string): Prisma.CustomerWhereInput {
  return ownerId ? { ownerId } : { ownerId: { not: null } };
}
function statsTotalWhere(ownerId?: string): Prisma.CustomerWhereInput {
  return ownerId ? { ownerId } : {};
}

type OrderAggRow = { customerId: string; _sum: { totalAmountCny: unknown }; _max: { orderDate: Date | null } };

/** 订单聚合 → 映射（对外维持 number 契约：totalAmountCny 为 Decimal → 显式转 number） */
function toOrderAggMap(rows: unknown[]): Record<string, { totalAmount: number; lastOrderDate: string | null }> {
  const map: Record<string, { totalAmount: number; lastOrderDate: string | null }> = {};
  for (const row of rows as OrderAggRow[]) {
    map[row.customerId] = {
      totalAmount: Number(row._sum.totalAmountCny ?? 0),
      lastOrderDate: row._max.orderDate ? row._max.orderDate.toISOString() : null,
    };
  }
  return map;
}

/** 商机金额聚合 → 映射 */
function toPipelineAggMap(rows: unknown[]): Record<string, { pipelineAmount: number }> {
  const map: Record<string, { pipelineAmount: number }> = {};
  for (const row of rows as { customerId: string | null; _sum: { estimatedAmount: unknown } }[]) {
    if (!row.customerId) continue;
    map[row.customerId] = { pipelineAmount: Number(row._sum.estimatedAmount ?? 0) };
  }
  return map;
}

/** 派生意向计数（与列表/详情共用同一 primitive `deriveCustomerIntentLevels`，口径完全一致） */
function deriveCounts(groups: { customerId: string; intentLevel: IntentLevel | null; _count: number }[]): Map<IntentLevel, number> {
  const derivedIntentByCustomer = deriveCustomerIntentLevels(groups);
  const counts = new Map<IntentLevel, number>();
  for (const level of derivedIntentByCustomer.values()) {
    if (level === null) continue;
    counts.set(level, (counts.get(level) ?? 0) + 1);
  }
  return counts;
}
