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

/**
 * 线索关联客户的读取投影（V1.1：客户信息唯一权威在 Customer，线索只存外键）。
 * 列表 / 详情 / 编辑回填一律经此对象取值，避免线索再持客户冗余列。
 * `contactMethods` / `customerType` 与 `companyName` 同属客户档案的基础展示字段，
 * 随线索可见性一并返回（不引入新的权限面）。
 */
const LEAD_CUSTOMER_SELECT = {
  id: true,
  companyName: true,
  contactName: true,
  email: true,
  phone: true,
  country: true,
  customerType: true,
  contactMethods: true,
  // 来源不变量：一个客户只有一种来源 —— 线索来源恒等于其客户来源，故详情需带出客户来源
  channelId: true,
  shopId: true,
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
    // V1.1：客户 / 产品主数据不再冗余在线索表，关键词改为按关系过滤
    // （线索名称 + 客户公司名 / 联系人 + 关联产品名），检索能力与改造前等价。
    where.OR = [
      { leadName: { contains: filters.keyword } },
      { customer: { companyName: { contains: filters.keyword } } },
      { customer: { contactName: { contains: filters.keyword } } },
      { items: { some: { product: { name: { contains: filters.keyword } } } } },
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
  } else if (filters.scope === 'all' && caller.isAdmin) {
    // 全部：**所有已归属（有负责人）的线索**，不含公海。管理员专用；
    // 非管理员传 all 不进入本分支，落到下方角色 dataScope，拿到的是本人范围（等同「我的」），不泄露全量
    where.ownerId = { not: null };
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

/**
 * 写入 / 刷新线索的客户快照（建档与确认前可刷新；写入内容 = 客户**当前**档案 + 渠道平台名称）。
 *
 * 规则（业务侧）：
 *   · 线索**未确认**（status = NEW）期间，每次线索更新都会刷新快照；
 *   · 线索**确认**（CONFIRMED 及之后）时固化最后一版，此后冻结不再改动；
 *   · 客户档案单独变更、但未更新线索时，快照不动（快照跟随线索更新节奏）。
 * 返回是否实际写入。`customerId` 为空（未关联客户）时不写。
 */
export async function refreshLeadCustomerSnapshotOperation(
  leadId: string,
  customerId: string | null | undefined,
  db?: DbClient,
): Promise<boolean> {
  if (!customerId) return false;
  const customer = await customerRepository.findSnapshotById(customerId, db);
  if (!customer) return false;

  const snapshot = {
    customerId: customer.id,
    customerNo: customer.customerNo,
    companyName: customer.companyName,
    contactName: customer.contactName,
    contactMethods: customer.contactMethods ?? null,
    email: customer.email,
    phone: customer.phone,
    country: customer.country,
    customerType: customer.customerType,
    ownerId: customer.ownerId,
    channelId: customer.channelId,
    shopId: customer.shopId,
    channelName: customer.channel?.name ?? null,
    shopName: customer.shop?.name ?? null,
  };

  await leadRepository.update(
    {
      where: { id: leadId },
      data: {
        customerSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        customerSnapshotAt: new Date(),
      },
    },
    db,
  );
  return true;
}

/** 暂存客户名匹配键：归一化（trim + 小写），与正式客户「大小写不敏感同名」口径一致 */
export function draftCustomerNameKey(raw?: string | null): string | null {
  const v = normalizeFilingName(raw);
  return v ? v.toLowerCase() : null;
}

/**
 * 他人**私海暂存**线索按名字占用查询。
 *
 * 口径：仅统计「暂存中」= `customerLocked = false` 且未关联客户、且**有负责人**的线索；
 * 公海暂存线索不占名（谁都可先认领再建档，符合公海语义）。
 */
export async function findDraftNameHolder(
  nameKey: string,
  excludeLeadId: string | null,
  db?: DbClient,
) {
  return leadRepository.findFirst(
    {
      where: {
        draftCustomerName: nameKey,
        customerId: null,
        customerLocked: false,
        ownerId: { not: null },
        ...(excludeLeadId ? { id: { not: excludeLeadId } } : {}),
      },
      select: {
        id: true,
        ownerId: true,
        owner: { select: { realName: true, username: true } },
      },
    },
    db,
  );
}

/**
 * **客户名占用判定**（跨全员、忽略数据范围）：正式客户 ∪ 他人私海暂存线索。
 *
 * 用途 = 「**暂存即阻塞**」：暂存阶段就拒绝撞名，避免两条线索各自暂存同一客户名、
 * 到建档那一刻才失败（也避免产生仅大小写 / 空白差异的重名客户）。
 */
export async function findCustomerNameOccupier(
  name: string,
  excludeLeadId: string | null,
  db?: DbClient,
): Promise<{ kind: 'CUSTOMER' | 'DRAFT'; companyName: string; ownerName?: string } | null> {
  const customerHit = await findAnyCustomerByName(name, db);
  if (customerHit) return { kind: 'CUSTOMER', companyName: customerHit.companyName };

  const key = draftCustomerNameKey(name);
  if (!key) return null;
  const holder = await findDraftNameHolder(key, excludeLeadId, db);
  if (!holder) return null;
  return {
    kind: 'DRAFT',
    companyName: normalizeFilingName(name) ?? name,
    ownerName: holder.owner?.realName || holder.owner?.username || undefined,
  };
}

/**
 * 暂存期客户信息（**不落客户库**，只登记在线索快照 + 占用键）。
 * 未提交的字段（`undefined`）保留既有快照值 —— 支持「只改一条备注也刷新快照」。
 */
export interface LeadDraftCustomerPatch {
  companyName?: string | null;
  contactName?: string | null;
  contactMethods?: unknown;
  email?: string | null;
  phone?: string | null;
  /** 线索侧「国家/地区」= `country`（显式）或 `targetMarket`，调用方已折算 */
  country?: string | null;
  customerType?: string | null;
  ownerId?: string | null;
  channelId?: string | null;
  shopId?: string | null;
}

/**
 * 写入 / 刷新**暂存期**客户快照：把本次提交的客户信息合并进既有快照，
 * 同步维护占用键 `draftCustomerName`（取合并后公司名的归一键；无公司名 → null）。
 * `customerId` 恒为 null —— 暂存客户不在客户库，无主键。
 */
export async function writeLeadDraftSnapshotOperation(
  leadId: string,
  patch: LeadDraftCustomerPatch,
  db?: DbClient,
): Promise<void> {
  const row = await leadRepository.findFirst(
    { where: { id: leadId }, select: { customerSnapshot: true } },
    db,
  );
  const prev = (row?.customerSnapshot ?? null) as Record<string, unknown> | null;
  const defined = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  ) as Record<string, unknown>;

  const merged: Record<string, unknown> = {
    customerNo: null,
    companyName: null,
    contactName: null,
    contactMethods: null,
    email: null,
    phone: null,
    country: null,
    customerType: null,
    ownerId: null,
    channelId: null,
    shopId: null,
    // 暂存期不解析渠道 / 平台名称（建档后由客户档案刷新补齐）
    channelName: null,
    shopName: null,
    ...(prev ?? {}),
    ...defined,
  };
  // 暂存期恒无客户主键（覆盖历史快照可能携带的旧 customerId，避免误读为已建档）
  merged.customerId = null;
  const name = normalizeFilingName(merged.companyName as string | null);
  merged.companyName = name;

  await leadRepository.update(
    {
      where: { id: leadId },
      data: {
        customerSnapshot: merged as unknown as Prisma.InputJsonValue,
        customerSnapshotAt: new Date(),
        draftCustomerName: draftCustomerNameKey(name),
      },
    },
    db,
  );
}

/** 清空暂存占用键（建档 / 关联既有客户后调用：占用改由正式客户承载） */
export async function clearLeadDraftNameOperation(leadId: string, db?: DbClient): Promise<void> {
  await leadRepository.update({ where: { id: leadId }, data: { draftCustomerName: null } }, db);
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

  // 客户快照投影：
  //   · 已关联客户 → 列表无需快照（客户关系已完整返回），剔除以免每行携带大字段；
  //   · **暂存线索（无客户）→ 客户信息只存在快照里，必须保留**，否则列表/卡片/表格客户列为空。
  //   · `draftCustomerName` 为占用检查的内部匹配键，一律不外泄。
  const rows = (list as Record<string, unknown>[]).map((row) => {
    const { draftCustomerName: _draftName, ...rest } = row;
    void _draftName;
    if (rest.customerId) {
      const { customerSnapshot: _snap, customerSnapshotAt: _snapAt, ...withoutSnap } = rest;
      void _snap;
      void _snapAt;
      return withoutSnap;
    }
    return rest;
  });

  return { list: rows, total, page, pageSize, attachmentMap };
}

/** 详情：单条线索 + 参考图片 */
export async function loadLeadDetail(where: Record<string, unknown>) {
  const item = await leadRepository.findFirst({ where, include: LEAD_INCLUDE });
  if (!item) return null;
  // `draftCustomerName` 为暂存占用检查的内部匹配键，不外泄
  const { draftCustomerName: _draftName, ...rest } = item as Record<string, unknown>;
  void _draftName;
  const attachmentMap = await loadLeadAttachments([item.id]);
  return { item: rest, attachments: attachmentMap[item.id] ?? [] };
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
// 3.5 V1.1 · FK-Only 建档：归一名称匹配（事务内，命中即复用）
// ============================================================

/**
 * 归一名称：trim 后交由 PostgreSQL 做大小写不敏感比较（`mode: 'insensitive'`）。
 * 空串 / 全空白视为「未提供」，返回 null。
 */
export function normalizeFilingName(raw?: string | null): string | null {
  const v = (raw ?? '').trim();
  return v ? v : null;
}

/**
 * 按归一名称匹配**可复用**的客户（命中即复用）。
 * `extraWhere` 为业务层给出的复用范围条件（方案 A 收紧后 = 本人 ∪ 公海；管理员为空条件不限）。
 * 仓储层不构造权限/政策条件 —— 范围由调用方传入（与既有分层约定一致）。
 */
export async function findReusableCustomerByName(
  name: string,
  extraWhere: Record<string, unknown>,
  db: DbClient,
) {
  return customerRepository.findFirst(
    {
      where: applyScope({ companyName: { equals: name, mode: 'insensitive' } }, extraWhere),
      select: { id: true, companyName: true, ownerId: true },
    },
    db,
  );
}

/**
 * 全库按归一名称匹配客户（忽略可见性）。
 * 用途：区分「可建档」与「他人已建档」——避免产生仅大小写/空白差异的重名客户；
 * 只返回主键与公司名，不返回归属人信息，不构成归属信息泄露。
 */
export async function findAnyCustomerByName(name: string, db?: DbClient) {
  return customerRepository.findFirst(
    {
      where: { companyName: { equals: name, mode: 'insensitive' } },
      select: { id: true, companyName: true },
    },
    db,
  );
}

/** 可见性范围内按归一名称匹配产品（命中即复用） */
export async function findReusableProductByName(
  name: string,
  scope: LeadScopeProvider,
  db: DbClient,
) {
  return productRepository.findFirst(
    {
      where: applyScope({ name: { equals: name, mode: 'insensitive' } }, scope.productVisibility()),
      select: { id: true, name: true },
    },
    db,
  );
}

// ============================================================
// 4. 创建（事务：建档 + 编号 + 主表 + 明细 + 附件）
// ============================================================

/**
 * 线索明细创建入参（V1.1 收敛后）。
 * 只保留下层仍存在的列：产品外键 + 意向数量 + **线索级**「客户具体要求」。
 * 产品名称 / 工艺 / 受众 / 品类 / 尺寸 / 克重一律不再落线索，唯一权威在 Product。
 */
export interface LeadItemCreateInput {
  productId: string | null;
  quantity: number;
  productDesc: string | null;
}

export interface AttachmentCreateInput {
  category: string;
  fileName: string;
  name: string;
  filePath: string;
  mimeType: string;
}

/**
 * 创建线索聚合（**建档 + Lead + LeadItem[] + Attachment[]**，单事务）。
 *
 * V1.1（lead-fk-only）：`resolveCustomerId` / `resolveProductId` 由 Business 层提供，
 * 在**同一事务内**先完成客户 / 产品建档（归一匹配既有记录则复用，否则新建），
 * 再把外键写入线索 —— 客户 / 产品 / 线索三者原子：任一失败则全部回滚
 * （编号计数一并回滚，不产生编号空洞，沿用既有语义）。
 */
export async function createLeadAggregate(input: {
  leadData: Omit<Prisma.LeadUncheckedCreateInput, 'leadNo' | 'usdRate' | 'customerId' | 'items'>;
  /** 汇率快照解析（由 Business 决定取值口径；在事务内、编号分配之后求值，保持既有顺序） */
  resolveUsdRate: () => Promise<number>;
  quantity: number;
  productDesc: string | null;
  attachments: AttachmentCreateInput[];
  actorUserId: string | null;
  /** 事务内客户建档 / 复用（不传 = 本次不关联客户） */
  resolveCustomerId?: (tx: TxClient) => Promise<string | null>;
  /** 事务内产品建档 / 复用（不传 = 本次不关联产品） */
  resolveProductId?: (tx: TxClient) => Promise<string | null>;
  /**
   * 事务内推导线索负责人（Business 提供的归属不变量：**客户由谁负责，线索负责人就是谁**）。
   * 返回 `undefined` = 不改动（沿用请求值）。
   */
  resolveOwnerId?: (tx: TxClient, customerId: string | null) => Promise<string | null | undefined>;
  /**
   * 事务内推导线索来源（来源不变量：**一个客户只有一种来源** —— 线索来源恒等于其客户的来源）。
   * 返回 `undefined` = 不改动（沿用 `leadData` 的 channelId/shopId）。
   */
  resolveSource?: (
    tx: TxClient,
    customerId: string | null,
  ) => Promise<{ channelId: string | null; shopId: string | null } | undefined>;
  /** 事务内收尾（如「建档写入客户快照」）：主表写入之后调用，仍在同一事务内 */
  afterWrite?: (tx: TxClient, leadId: string, customerId: string | null) => Promise<void>;
}) {
  return runInTransaction(async (tx: TxClient) => {
    const customerId = input.resolveCustomerId ? await input.resolveCustomerId(tx) : null;
    const productId = input.resolveProductId ? await input.resolveProductId(tx) : null;
    // 归属推导在客户关联确定之后、写入之前（可能同时认领公海客户 → 必须同事务）
    const ownerId = input.resolveOwnerId ? await input.resolveOwnerId(tx, customerId) : undefined;
    // 来源推导同样在客户关联确定之后、写入之前（客户尚无来源时由本次线索确立 → 必须同事务）
    const source = input.resolveSource ? await input.resolveSource(tx, customerId) : undefined;

    // 明细：有产品外键、或有线索级「客户具体要求」时建立一条意向明细
    const items: LeadItemCreateInput[] =
      productId || input.productDesc
        ? [{ productId, quantity: input.quantity, productDesc: input.productDesc }]
        : [];

    const leadNo = await getNextNumber(tx, 'LEAD');

    const lead = await leadRepository.create(
      {
        data: {
          ...input.leadData,
          customerId,
          // 归属不变量优先于请求值（客户负责人 → 线索负责人）
          ...(ownerId !== undefined ? { ownerId } : {}),
          // 来源不变量优先于请求值（客户来源 → 线索来源）
          ...(source ? { channelId: source.channelId, shopId: source.shopId } : {}),
          leadNo,
          usdRate: await input.resolveUsdRate(),
          ...(items.length ? { items: { create: items } } : {}),
        },
      },
      tx,
    );

    if (input.afterWrite) await input.afterWrite(tx, lead.id, customerId);

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
 * V1.1：本流程改为**由 `updateLeadAggregate` 包裹在事务内执行**（建档 + 更新原子），
 * 因此所有写入统一走传入的 `db`（事务客户端）。
 */
export async function updateLeadRecord(input: {
  leadId: string;
  update: Record<string, unknown>;
  images?: unknown;
  /** 显式传入 productId 时整组替换明细；null 表示清空产品关联 */
  productId?: string | null;
  /** 线索级「客户具体要求」，与 Product.description 无关 */
  productDesc?: string | null;
  quantity?: number;
  attachmentRows?: AttachmentCreateInput[];
  actorUserId: string | null;
  /** 事务客户端（由 updateLeadAggregate 传入） */
  db: DbClient;
}) {
  await leadRepository.update(
    { where: { id: input.leadId }, data: input.update as Prisma.LeadUncheckedUpdateInput },
    input.db,
  );

  // 附件整组替换（仅在显式传入 images 时执行）
  if (input.attachmentRows !== undefined) {
    await attachmentRepository.deleteByOwner('LEAD', input.leadId, input.db);
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
        input.db,
      );
    }
  }

  // LeadItem 明细维护（V1.1：明细只有 productId / quantity / productDesc 三列）
  // 沿用既有「显式传 productId 则整组替换 / 否则增量更新」语义
  if (input.productId !== undefined) {
    await leadRepository.items.deleteManyByLead(input.leadId, input.db);
    if (input.productId) {
      await leadRepository.items.create(
        {
          leadId: input.leadId,
          productId: input.productId,
          productDesc: input.productDesc ?? null,
          quantity: input.quantity || 1,
        },
        input.db,
      );
    }
  } else {
    const patch: Record<string, unknown> = {};
    if (input.productDesc !== undefined) patch.productDesc = input.productDesc ?? null;
    if (input.quantity !== undefined) patch.quantity = input.quantity || 1;
    if (Object.keys(patch).length) {
      const existingItem = await leadRepository.items.findFirstByLead(input.leadId, input.db);
      if (existingItem) {
        await leadRepository.items.updateById(
          existingItem.id,
          patch as Prisma.LeadItemUncheckedUpdateInput,
          input.db,
        );
      } else {
        await leadRepository.items.create(
          {
            leadId: input.leadId,
            productId: null,
            productDesc: input.productDesc ?? null,
            quantity: input.quantity || 1,
          },
          input.db,
        );
      }
    }
  }
}

/**
 * 更新线索聚合（**建档 + 主表 + 明细 + 附件**，单事务）。
 *
 * V1.1：把原先「无事务的顺序写入」收敛为单事务，并与客户 / 产品建档同事务：
 * `resolveCustomerId` / `resolveProductId` 返回 `undefined` 表示**本次不改动该项关联**
 * （未提交公司名 / 产品名时不得清空既有外键），返回 `null` 表示显式清空。
 */
export async function updateLeadAggregate(input: {
  leadId: string;
  update: Record<string, unknown>;
  productDesc?: string | null;
  quantity?: number;
  attachmentRows?: AttachmentCreateInput[];
  actorUserId: string | null;
  resolveCustomerId?: (tx: TxClient) => Promise<string | null | undefined>;
  resolveProductId?: (tx: TxClient) => Promise<string | null | undefined>;
  /**
   * 事务内推导线索负责人（归属不变量：客户由谁负责，线索负责人就是谁）。
   * 形参 `customerId` 为**本次生效的客户关联**（`undefined` = 未改动，由 Business 回退既有值）。
   * 返回 `undefined` = 不改动负责人。
   */
  resolveOwnerId?: (
    tx: TxClient,
    customerId: string | null | undefined,
  ) => Promise<string | null | undefined>;
  /**
   * 事务内推导线索来源（来源不变量：**一个客户只有一种来源** —— 线索来源恒等于其客户的来源）。
   * 返回 `undefined` = 不改动来源。
   */
  resolveSource?: (
    tx: TxClient,
    customerId: string | null | undefined,
  ) => Promise<{ channelId: string | null; shopId: string | null } | undefined>;
  /**
   * 事务内收尾（如「建档写入客户快照」）：在客户关联 / 归属 / 来源推导完成之后、
   * 主表写入之前调用，仍在同一事务内。
   */
  afterResolve?: (tx: TxClient, customerId: string | null | undefined) => Promise<void>;
}) {
  return runInTransaction(async (tx: TxClient) => {
    const customerId = input.resolveCustomerId ? await input.resolveCustomerId(tx) : undefined;
    if (customerId !== undefined) input.update.customerId = customerId;

    // 归属不变量：负责人随客户（undefined = 本次不改动负责人）
    if (input.resolveOwnerId) {
      const ownerId = await input.resolveOwnerId(tx, customerId);
      if (ownerId !== undefined) input.update.ownerId = ownerId;
    }

    // 来源不变量：来源随客户（undefined = 本次不改动来源）
    if (input.resolveSource) {
      const source = await input.resolveSource(tx, customerId);
      if (source) {
        input.update.channelId = source.channelId;
        input.update.shopId = source.shopId;
      }
    }

    // 收尾（建档快照）：客户关联已确定、主表尚未写入 —— 同事务内一次性留痕
    if (input.afterResolve) await input.afterResolve(tx, customerId);

    // undefined = 本次不改动明细的产品关联；string | null = 整组替换 / 清空
    const productId = input.resolveProductId ? await input.resolveProductId(tx) : undefined;

    await updateLeadRecord({
      leadId: input.leadId,
      update: input.update,
      productId,
      productDesc: input.productDesc,
      quantity: input.quantity,
      attachmentRows: input.attachmentRows,
      actorUserId: input.actorUserId,
      db: tx,
    });
  });
}

// ============================================================
// 6. 归属联动（release / claim / transfer，各自一个事务）
// ============================================================

/**
 * 释放：线索 → 公海。
 * `releaseCustomerId` 由 Business 决定（规则 1：线索放弃到公海 ⇒ **客户必然一并放归公海**，
 * 故线索有客户时该参数恒为其 id）。
 * `releaseProductIds` 为线索关联的全部产品（规则 2：**产品同样强制联动**，
 * 不论可见性一律置公开并清空负责人；空数组表示该线索未关联产品）。
 */
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
