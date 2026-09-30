import type { AttachmentOwnerType, Prisma } from '@prisma/client';
import { getNextNumber } from '../lib/numberSequence';
import { attachmentRepository } from '../repositories/attachment.repository';
import { customerRepository } from '../repositories/customer.repository';
import { dailyExchangeRateRepository } from '../repositories/dailyExchangeRate.repository';
import { leadRepository } from '../repositories/lead.repository';
import { productRepository } from '../repositories/product.repository';
import { userRepository } from '../repositories/user.repository';
import { runInTransaction, type DbClient, type TxClient } from '../repositories';
import { applyScope } from '../scope';

/**
 * Lead Operation Layer（Round R-2 · Lead Pilot）
 *
 * 职责：**可复用的数据操作流程 / 多仓储组合 / 事务编排**。
 * 不负责业务政策判断 —— 「什么条件下允许」由 Business Layer（services/lead.service.ts）决定，
 * 本层只执行「已经被 Business 决定的数据操作」。
 *
 * 事务边界：所有 Prisma `$transaction` 都收在本层（Controller / Business 不出现 `$transaction`）。
 */

// ============================================================
// 通用类型
// ============================================================

/** 调用者身份（由 Controller 在 HTTP 边界注入，Operation 不读取 req） */
export interface LeadCaller {
  userId?: string;
  roleCode?: string;
  isAdmin: boolean;
}

/** 数据范围提供者（由 Controller 用 scope + req 组装；Operation 只调用，不实现权限政策） */
export interface LeadScopeProvider {
  /** 按 ownerId 过滤（roleScope(req, { field: 'ownerId' })） */
  owner(): Promise<Record<string, unknown>>;
  /** 按目标用户 id 过滤（roleScope(req, { field: 'id' })），用于「归属人是否可指派」 */
  assignee(): Promise<Record<string, unknown>>;
  /** 客户引用授权（includePublicSea(await roleScope(req))：owner ∪ 公海 ∪ admin） */
  customer(): Promise<Record<string, unknown>>;
  /** 产品可见性条件（productVisibilityWhere(req)） */
  productVisibility(): Record<string, unknown>;
}

/** 列表筛选入参（与既有 query 参数一一对应，未新增字段） */
export interface LeadListFilters {
  page?: number | string;
  pageSize?: number | string;
  keyword?: string;
  channel?: string;
  platform?: string;
  status?: string;
  source?: string;
  ownerId?: string;
  productId?: string;
  scope?: string;
  sort?: string;
}

/** 排序白名单（防任意字段注入；未传时 paginateList 默认 createdAt 倒序） */
const SORT_WHITELIST: Record<string, Record<string, 'asc' | 'desc'>> = {
  'createdAt:desc': { createdAt: 'desc' },
  'createdAt:asc': { createdAt: 'asc' },
  'updatedAt:desc': { updatedAt: 'desc' },
  'updatedAt:asc': { updatedAt: 'asc' },
};

/** 列表 / 详情统一 include（沿用既有投影白名单，未增删字段） */
export const LEAD_ITEM_PRODUCT_FIELDS = ['id', 'name'] as const;

const LEAD_ITEM_PRODUCT_SELECT = {
  id: true,
  name: true,
  visibility: true,
  createdBy: true,
  visibleUsers: { select: { userId: true } },
} as const;

const LEAD_CUSTOMER_SELECT = {
  id: true,
  companyName: true,
  contactName: true,
  email: true,
  phone: true,
  country: true,
} as const;

const LEAD_INCLUDE = {
  customer: { select: LEAD_CUSTOMER_SELECT },
  items: { include: { product: { select: LEAD_ITEM_PRODUCT_SELECT } } },
  owner: { select: { id: true, username: true, realName: true } },
  channel: { select: { id: true, name: true } },
  shop: { select: { id: true, name: true } },
} as const;

// ============================================================
// 1. 列表查询条件（查询组合，非业务政策）
// ============================================================

/**
 * 构造线索列表 where（与既有 getLeads 的构造顺序、分支、优先级逐条一致）。
 *
 * 说明：`scope.owner()` 仅在既有的 else 分支被调用（保持原有的**惰性**语义：
 * mine/pool/admin-ownerId 分支不触发部门树查询）。
 */
export async function buildLeadListWhere(
  filters: LeadListFilters,
  caller: LeadCaller,
  scope: LeadScopeProvider,
): Promise<Record<string, unknown>> {
  let where: Record<string, unknown> = {};

  if (filters.keyword) {
    where.OR = [
      { leadName: { contains: filters.keyword } },
      { companyName: { contains: filters.keyword } },
      { contactName: { contains: filters.keyword } },
      { email: { contains: filters.keyword } },
      { phone: { contains: filters.keyword } },
    ];
  }
  // 来源渠道 / 来源平台：按 channelId / shopId 精确匹配（前端筛选项已改为传 ID）
  if (filters.channel && filters.platform) {
    where.AND = [{ channelId: filters.channel }, { shopId: filters.platform }];
  } else if (filters.channel) {
    where.channelId = filters.channel;
  } else if (filters.platform) {
    where.shopId = filters.platform;
  }
  if (filters.status) where.status = filters.status;
  if (filters.source) where.source = filters.source;
  if (filters.productId) where.items = { some: { productId: String(filters.productId) } };

  if (filters.scope === 'mine' || filters.scope === 'pool') {
    where.ownerId = filters.scope === 'mine' ? (caller.userId ?? '') : null;
  } else if (filters.ownerId && caller.isAdmin) {
    // 管理员可用 ownerId 自由筛选；其余用户按角色 dataScope 过滤（含公海）
    where.ownerId = filters.ownerId;
  } else {
    where = applyScope(where, await scope.owner());
  }

  return where;
}

export function resolveLeadListOrderBy(sort?: string) {
  return SORT_WHITELIST[sort ?? ''];
}

/** 列表：分页查询 + 批量拉取参考图片附件（避免 N+1） */
export async function loadLeadsPage(input: {
  where: Record<string, unknown>;
  page: number;
  pageSize: number;
  orderBy?: Record<string, 'asc' | 'desc'>;
}): Promise<{ list: Record<string, unknown>[]; total: number; page: number; pageSize: number; attachmentMap: Record<string, unknown[]> }> {
  const { list, total, page, pageSize } = await leadRepository.paginate(input.where, {
    page: input.page,
    pageSize: input.pageSize,
    orderBy: input.orderBy,
    include: LEAD_INCLUDE,
  });

  const leadIds = (list as { id: string }[]).map((l) => l.id);
  const attachmentMap = await loadLeadAttachments(leadIds);

  return { list: list as Record<string, unknown>[], total, page, pageSize, attachmentMap };
}

/** 详情：单条线索 + 参考图片 */
export async function loadLeadDetail(where: Record<string, unknown>) {
  const item = await leadRepository.findFirst({ where, include: LEAD_INCLUDE });
  if (!item) return null;
  const attachmentMap = await loadLeadAttachments([item.id]);
  return { item: item as Record<string, unknown>, attachments: attachmentMap[item.id] ?? [] };
}

/** 批量拉取线索参考图片附件（ownerType=LEAD），按 ownerId 分组 */
export async function loadLeadAttachments(leadIds: string[]): Promise<Record<string, unknown[]>> {
  if (!leadIds.length) return {};
  const rows = await attachmentRepository.findByOwnerTypeAndIds('LEAD', leadIds);
  const map: Record<string, unknown[]> = {};
  for (const r of rows) (map[r.ownerId] ||= []).push(r);
  return map;
}

/** 操作记录上下文：线索可见性 + 关联客户/产品主键（沿用既有 select） */
export function findLeadForLogs(where: Record<string, unknown>, db: DbClient | undefined = undefined) {
  return leadRepository.findFirst(
    { where, select: { id: true, customerId: true, items: { select: { productId: true } } } },
    db,
  );
}

// ============================================================
// 2. 归属人 / 引用校验（多仓储读取组合）
// ============================================================

/** 归属人（或目标转交人）是否存在于调用方数据范围（scope 外与不存在同结果） */
export async function resolveScopedUser(id: string, scope: LeadScopeProvider) {
  return userRepository.findScopedById(id, await scope.assignee());
}

/** 转交目标用户：除存在性外还需 status（ACTIVE 校验）与展示名 */
export async function resolveScopedTransferTarget(id: string, scope: LeadScopeProvider) {
  return userRepository.findScopedTransferTarget(id, await scope.assignee());
}

/** 客户引用授权（owner ∪ 公海 ∪ admin） */
export async function resolveScopedCustomer(id: string, scope: LeadScopeProvider) {
  return customerRepository.findScopedById(id, await scope.customer());
}

/** 产品引用可见性（不可见与不存在同结果） */
export async function resolveVisibleProduct(id: string, scope: LeadScopeProvider) {
  return productRepository.findVisibleById(id, scope.productVisibility());
}

// ============================================================
// 3. 汇率快照（数据组合 + 常量回退）
// ============================================================

/** 内置参考值（与 exchange.controller FALLBACK_RATES 一致） */
export const USD_FALLBACK_RATE = 7.14285714;

/**
 * 抓取「创建线索美元汇率」：当日 USD 优先，缺则最近历史，都无则内置参考值。
 * 该值于线索创建时落库一次（Lead.usdRate），与线索自身币种无关，创建后不再刷新。
 */
export async function resolveUsdRate(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const toDbDate = (d: string) => new Date(`${d}T00:00:00.000Z`);
  let row = await dailyExchangeRateRepository.findOnDate(toDbDate(today), 'USD');
  if (!row) row = await dailyExchangeRateRepository.findLatest('USD');
  if (row) return Number(row.rateToCny);
  return USD_FALLBACK_RATE;
}

// ============================================================
// 4. 创建（事务：编号 + 主表 + 附件）
// ============================================================

export interface LeadItemCreateInput {
  productId: string | null;
  productName: string | null;
  quantity: number;
  productDesc: string | null;
  craftIds: string[];
  audienceId: string | null;
  categoryId: string | null;
  sizeL: number | null;
  sizeW: number | null;
  sizeH: number | null;
  weight: number | null;
}

export interface AttachmentCreateInput {
  category: string;
  fileName: string;
  name: string;
  filePath: string;
  mimeType: string;
}

/**
 * 创建线索聚合（Lead + LeadItem[] + Attachment[]）。
 * 事务：编号分配与业务写入同事务 —— 业务失败则计数一并回滚，不产生编号空洞（沿用既有语义）。
 */
export async function createLeadAggregate(input: {
  leadData: Omit<Prisma.LeadUncheckedCreateInput, 'leadNo' | 'usdRate'>;
  /** 汇率快照解析（由 Business 决定取值口径；在事务内、编号分配之后求值，保持既有顺序） */
  resolveUsdRate: () => Promise<number>;
  items?: LeadItemCreateInput[];
  attachments: AttachmentCreateInput[];
  actorUserId: string | null;
}) {
  return runInTransaction(async (tx: TxClient) => {
    const leadNo = await getNextNumber(tx, 'LEAD');

    const lead = await leadRepository.create(
      {
        data: {
          ...input.leadData,
          leadNo,
          usdRate: await input.resolveUsdRate(),
          ...(input.items ? { items: { create: input.items } } : {}),
        },
      },
      tx,
    );

    if (input.attachments.length) {
      await attachmentRepository.createMany(
        input.attachments.map((a) => ({
          ownerType: 'LEAD' as AttachmentOwnerType,
          ownerId: lead.id,
          category: a.category,
          fileName: a.fileName,
          name: a.name,
          filePath: a.filePath,
          mimeType: a.mimeType,
          fileSize: null,
          uploadedBy: input.actorUserId,
        })),
        tx,
      );
    }

    return lead;
  });
}

// ============================================================
// 5. 更新（主表 + 附件整组替换 + 明细维护）
// ============================================================

/**
 * 更新线索：主表字段 + 附件（整组替换）+ LeadItem 明细维护。
 *
 * 事务边界：**保持既有行为 —— 本流程原先未包裹事务**，此处不新增事务，
 * 以免改变「部分失败」的既有语义（已作为 R-2 发现上报，是否收敛由后续决策）。
 */
export async function updateLeadRecord(input: {
  leadId: string;
  update: Record<string, unknown>;
  images?: unknown;
  productId?: string | null;
  productName?: string | null;
  productDesc?: string | null;
  resolvedProductName?: string | null;
  itemExtra: Record<string, unknown>;
  quantity?: number;
  attachmentRows?: AttachmentCreateInput[];
  actorUserId: string | null;
}) {
  await leadRepository.update({ where: { id: input.leadId }, data: input.update as Prisma.LeadUncheckedUpdateInput });

  // 附件整组替换（仅在显式传入 images 时执行）
  if (input.attachmentRows !== undefined) {
    await attachmentRepository.deleteByOwner('LEAD', input.leadId);
    if (input.attachmentRows.length) {
      await attachmentRepository.createMany(
        input.attachmentRows.map((a) => ({
          ownerType: 'LEAD' as AttachmentOwnerType,
          ownerId: input.leadId,
          category: a.category,
          fileName: a.fileName,
          name: a.name,
          filePath: a.filePath,
          mimeType: a.mimeType,
          fileSize: null,
          uploadedBy: input.actorUserId,
        })),
      );
    }
  }

  // LeadItem 明细维护（沿用既有「显式传 productId 则整组替换 / 否则增量更新」语义）
  if (input.productId !== undefined) {
    await leadRepository.items.deleteManyByLead(input.leadId);
    if (input.productId) {
      await leadRepository.items.create({
        leadId: input.leadId,
        productId: input.productId,
        productName: input.resolvedProductName ?? input.productName ?? null,
        productDesc: input.productDesc ?? null,
        quantity: input.quantity || 1,
        ...input.itemExtra,
      });
    } else if (input.productName || input.productDesc || Object.keys(input.itemExtra).length) {
      await leadRepository.items.create({
        leadId: input.leadId,
        productId: null,
        productName: input.productName ?? null,
        productDesc: input.productDesc ?? null,
        quantity: input.quantity || 1,
        ...input.itemExtra,
      });
    }
  } else {
    const patch: Record<string, unknown> = {};
    if (input.productName !== undefined) patch.productName = input.productName ?? null;
    if (input.productDesc !== undefined) patch.productDesc = input.productDesc ?? null;
    Object.assign(patch, input.itemExtra);
    if (Object.keys(patch).length) {
      const existingItem = await leadRepository.items.findFirstByLead(input.leadId);
      if (existingItem) {
        await leadRepository.items.updateById(existingItem.id, patch as Prisma.LeadItemUncheckedUpdateInput);
      } else {
        await leadRepository.items.create({
          leadId: input.leadId,
          productId: null,
          productName: input.productName ?? null,
          productDesc: input.productDesc ?? null,
          quantity: input.quantity || 1,
          ...input.itemExtra,
        });
      }
    }
  }
}

// ============================================================
// 6. 归属联动（release / claim / transfer，各自一个事务）
// ============================================================

/** 释放：线索 → 公海；可选联动客户 → 公海、产品 → 公开 */
export async function releaseLeadOwnership(input: {
  leadId: string;
  releaseCustomerId: string | null;
  releaseProductIds: string[];
}) {
  await runInTransaction(async (tx) => {
    await leadRepository.update({ where: { id: input.leadId }, data: { ownerId: null } }, tx);
    if (input.releaseCustomerId) {
      await customerRepository.releaseToPool(input.releaseCustomerId, tx);
    }
    if (input.releaseProductIds.length) {
      await productRepository.releaseToPublic(input.releaseProductIds, tx);
    }
  });
}

/** 认领：线索 → 指定用户；可选联动客户 → 指定用户、无归属产品 → 指定用户 */
export async function claimLeadOwnership(input: {
  leadId: string;
  claimCustomerId: string | null;
  claimProductIds: string[];
  userId: string;
}) {
  await runInTransaction(async (tx) => {
    await leadRepository.update({ where: { id: input.leadId }, data: { ownerId: input.userId } }, tx);
    if (input.claimCustomerId) {
      await customerRepository.updateOwner(input.claimCustomerId, input.userId, tx);
    }
    if (input.claimProductIds.length) {
      await productRepository.updateOwnerMany(input.claimProductIds, input.userId, tx);
    }
  });
}

/** 转交：线索 → 目标用户；可选联动客户 → 目标用户、私密产品加入目标用户可见人 */
export async function transferLeadOwnership(input: {
  leadId: string;
  transferCustomerId: string | null;
  visibleUserProductIds: string[];
  newOwnerId: string;
}) {
  await runInTransaction(async (tx) => {
    await leadRepository.update({ where: { id: input.leadId }, data: { ownerId: input.newOwnerId } }, tx);
    if (input.transferCustomerId) {
      await customerRepository.updateOwner(input.transferCustomerId, input.newOwnerId, tx);
    }
    for (const productId of input.visibleUserProductIds) {
      await productRepository.connectVisibleUser(productId, input.newOwnerId, tx);
    }
  });
}
