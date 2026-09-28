import type { AttachmentOwnerType } from '@prisma/client';
import { activityLogger } from '../lib/activity-logger';
import { BUSINESS_TYPE } from '../lib/business-type';
import { DomainNotFoundError, DomainValidationError } from '../lib/errors';
import { computeDiff, type FieldFormatter } from '../lib/operation-diff';
import {
  buildLeadListWhere,
  claimLeadOwnership,
  createLeadAggregate,
  findLeadForLogs,
  loadLeadDetail,
  loadLeadsPage,
  releaseLeadOwnership,
  resolveLeadListOrderBy,
  resolveScopedCustomer,
  resolveScopedTransferTarget,
  resolveScopedUser,
  resolveUsdRate,
  resolveVisibleProduct,
  transferLeadOwnership,
  updateLeadRecord,
  type LeadCaller,
  type LeadItemCreateInput,
  type LeadListFilters,
  type LeadScopeProvider,
  type AttachmentCreateInput,
} from '../operations/lead.operations';
import { attachmentRepository } from '../repositories/attachment.repository';
import { channelRepository } from '../repositories/channel.repository';
import { customerRepository } from '../repositories/customer.repository';
import { leadRepository } from '../repositories/lead.repository';
import { operationLogRepository } from '../repositories/operationLog.repository';
import { productRepository } from '../repositories/product.repository';
import { applyScope } from '../utils/scope';

/**
 * Lead Business Layer（Round R-2 · Lead Pilot）
 *
 * 职责：Lead 的业务规则、业务不变量、状态语义、跨实体流程决策、事务编排入口、审计留痕。
 * 约束：
 *   - 不读取 / 不返回 HTTP（无 req / res / statusCode）；
 *   - 业务失败以 `DomainError`（lib/errors）表达，由 Controller 的 HTTP 边界映射为状态码；
 *   - **不直接调用 Prisma**：数据访问一律经 repositories / operations。
 *
 * 【业务基线保持不变】本文件是既有 Controller 内业务逻辑的**搬迁**，
 * 不重新解释任何规则（Draft 语义、leadName 生成、必填口径、公海/认领/转交授权、
 * 状态「只由单据事件推进」、`Lead.source` 语义、`channelId/shopId` 语义均逐字沿用）。
 */

// ============================================================
// 上下文
// ============================================================

/** 调用者上下文：由 Controller 在 HTTP 边界组装（actor + 数据范围提供者） */
export interface LeadActorContext {
  userId?: string;
  username?: string;
  realName?: string;
  roleCode?: string;
  /**
   * 列表筛选口径：`roleCode === 'admin' || 'ADMIN'`
   * （沿用既有 getLeads 中「管理员可用 ownerId 自由筛选」的判据）。
   */
  isAdmin: boolean;
  /**
   * 归属 / 联动授权口径：`roleCode === 'admin'`（**严格小写**）
   * （沿用既有 releaseLead / transferLead 中 actor 与 Customer 联动授权的判据）。
   * 两个判据在既有代码中确实不同，此处并列保留，不改写既有行为。
   */
  isStrictAdmin: boolean;
  ip?: string;
  scope: LeadScopeProvider;
}

function toCaller(ctx: LeadActorContext): LeadCaller {
  return { userId: ctx.userId, roleCode: ctx.roleCode, isAdmin: ctx.isAdmin };
}

/** 「当前用户数据范围 + id」条件（与既有 scopedWhere 逐字一致；不并入公海） */
async function scopedWhere(ctx: LeadActorContext, id: string): Promise<Record<string, unknown>> {
  return applyScope({ id }, await ctx.scope.owner());
}

/** 通过数据范围门后仍不存在 ⇒ 与越权同响应（404，「线索不存在」） */
async function requireVisibleLead(ctx: LeadActorContext, id: string) {
  const lead = await leadRepository.findFirst({ where: await scopedWhere(ctx, id) });
  if (!lead) throw new DomainNotFoundError('线索不存在');
  return lead;
}

// ============================================================
// 字段级差异（操作日志）—— 沿用既有标签与格式化口径
// ============================================================

const LEAD_DIFF_LABELS: Record<string, string> = {
  leadName: '线索名称',
  customerId: '客户',
  channelId: '来源渠道',
  shopId: '来源平台',
  source: '来源',
  companyName: '公司名称',
  contactName: '联系人',
  contactMethods: '联系方式',
  email: '邮箱',
  phone: '电话',
  country: '国家',
  productInterest: '产品意向',
  quantity: '数量',
  remark: '备注',
  targetMarket: '目标国家/地区',
  currency: '币种',
  unit: '单位',
  targetPrice: '目标价位',
  usdRate: '创建美元汇率',
  expectedDelivery: '期望交期',
  customerType: '客户类型',
  ownerId: '负责人',
  stage: '步骤',
};

/** 字段值格式化：来源渠道/平台按 ID 解析为名称，联系方式解析为「工具：账号」形式 */
const LEAD_DIFF_FORMATTERS: Record<string, FieldFormatter> = {
  channelId: async (v) => {
    if (!v) return '空';
    const ch = await channelRepository.findNameById(v as string);
    return ch?.name ?? String(v);
  },
  shopId: async (v) => {
    if (!v) return '空';
    const ch = await channelRepository.findNameById(v as string);
    return ch?.name ?? String(v);
  },
  contactMethods: (v) => {
    if (!Array.isArray(v) || v.length === 0) return '空';
    return (v as { tool?: string; account?: string }[])
      .map((m) => `${m?.tool || '—'}：${m?.account || '—'}`)
      .join('、');
  },
  expectedDelivery: (v) => {
    if (!v) return '空';
    const d = new Date(v as string);
    if (Number.isNaN(d.getTime())) return String(v);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  },
  quantity: (v) => {
    if (v == null || v === '' || Number(v) === 0) return '空';
    return String(Number(v));
  },
  stage: (v) => {
    if (v == null || v === '') return '空';
    const map: Record<string, string> = { '0': '客户信息', '1': '需求详情', '2': '确认商机' };
    return map[String(v)] ?? String(v);
  },
};

// ============================================================
// 附件输入归一化（D1：Attachment ownerType=LEAD）
// ============================================================

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  zip: 'application/zip',
  rar: 'application/x-rar-compressed',
};

/**
 * 归一化前端传来的参考图片/附件。接受「URL 字符串」或「{url,name}」对象数组，
 * 从 /api/uploads/{filename} 还原文件名，并按扩展名推导 mimeType 与 category
 * （图片 → IMAGE，其它 → OTHER）。仅保留 /api/uploads/ 下的文件，避免写入任意外链。
 */
function normalizeAttachments(
  images?: (string | { url: string; name?: string })[] | null,
): AttachmentCreateInput[] {
  if (!Array.isArray(images)) return [];
  return images
    .map((i) => (typeof i === 'string' ? { url: i, name: undefined } : { url: i.url, name: i.name }))
    .filter((x) => x.url && x.url.startsWith('/api/uploads/'))
    .map((x) => {
      const m = x.url.match(/\/api\/uploads\/(.+)$/);
      const fileName = m ? m[1] : x.url;
      const ext = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : '';
      const mimeType = MIME_BY_EXT[ext] || 'application/octet-stream';
      const category = mimeType.startsWith('image/') ? 'IMAGE' : 'OTHER';
      return { category, fileName, name: x.name ?? fileName, filePath: x.url, mimeType };
    });
}

// ============================================================
// 业务不变量
// ============================================================

/**
 * 来源渠道 / 来源平台契约校验（create / update 共用）。
 *
 * 现系统对 Channel / Shop **没有** per-user permission / ownership / visibility 机制
 * （Channel 属全局主数据）。故仅做：
 *   1) 引用存在性：`channelId` / `shopId` 必须是 ACTIVE 的 Channel（可空，不强制必填）；
 *   2) 硬业务规则：当两者**同时非空**时，必须满足 `shop.parentId === channelId`。
 * 不发明第二套 Channel 权限体系；不存在与非法同结果（400），避免存在性 oracle。
 */
async function assertChannelShop(
  channelId: string | null | undefined,
  shopId: string | null | undefined,
): Promise<void> {
  if (channelId !== undefined && channelId !== null) {
    const ch = await channelRepository.findStatusById(channelId);
    if (!ch || ch.status !== 'ACTIVE') throw new DomainValidationError('来源渠道不存在');
  }
  if (shopId !== undefined && shopId !== null) {
    const shop = await channelRepository.findStatusWithParentById(shopId);
    if (!shop || shop.status !== 'ACTIVE') throw new DomainValidationError('来源平台不存在');
    if (channelId !== undefined && channelId !== null && shop.parentId !== channelId) {
      throw new DomainValidationError('来源平台不属于所选来源渠道');
    }
  }
}

/** 归属人（显式指定时）必须存在于当前用户数据范围；null / undefined 不触发校验（公海） */
async function assertAssignableOwner(ownerId: string | null | undefined, ctx: LeadActorContext): Promise<void> {
  if (ownerId === undefined || ownerId === null) return;
  const owner = await resolveScopedUser(ownerId, ctx.scope);
  if (!owner) throw new DomainValidationError('业务归属人不存在或无权限指派');
}

/** 客户引用授权（owner ∪ 公海 ∪ admin）；null / undefined 不触发（清空引用透传） */
async function assertVisibleCustomer(customerId: string | null | undefined, ctx: LeadActorContext): Promise<void> {
  if (customerId === undefined || customerId === null) return;
  const customer = await resolveScopedCustomer(customerId, ctx.scope);
  if (!customer) throw new DomainValidationError('客户不存在');
}

/** 产品引用可见性（不可见与不存在同结果） */
async function requireVisibleProductName(productId: string, ctx: LeadActorContext): Promise<string> {
  const product = await resolveVisibleProduct(productId, ctx.scope);
  if (!product) throw new DomainValidationError('产品不存在');
  return product.name;
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

// ============================================================
// 用例
// ============================================================

export { LEAD_ITEM_PRODUCT_FIELDS } from '../operations/lead.operations';
export type { LeadListFilters, LeadItemCreateInput, LeadScopeProvider } from '../operations/lead.operations';

/** 列表：分页 + 多维筛选（where 构造在 Operation 层） */
export async function listLeads(filters: LeadListFilters, ctx: LeadActorContext) {
  const page = Math.max(1, Number(filters.page ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize ?? 20) || 20));
  const where = await buildLeadListWhere(filters, toCaller(ctx), ctx.scope);
  return loadLeadsPage({ where, page, pageSize, orderBy: resolveLeadListOrderBy(filters.sort) });
}

/** 详情：数据范围门后返回线索 + 参考图片（不存在与越权同结果 404） */
export async function getLeadDetail(id: string, ctx: LeadActorContext) {
  const detail = await loadLeadDetail(await scopedWhere(ctx, id));
  if (!detail) throw new DomainNotFoundError('线索不存在');
  return detail;
}

/**
 * 操作记录：只读 OperationLog 中 businessType=LEAD（+ 关联 CUSTOMER / PRODUCT）的记录，
 * 按时间倒序返回。线索不可见与不存在同响应 404。
 */
export async function getLeadLogs(id: string, ctx: LeadActorContext) {
  const lead = await findLeadForLogs(await scopedWhere(ctx, id));
  if (!lead) throw new DomainNotFoundError('线索不存在');

  const productId = lead.items?.[0]?.productId ?? null;
  return operationLogRepository.findByBusiness(
    {
      OR: [
        { businessType: BUSINESS_TYPE.LEAD, businessId: lead.id },
        ...(lead.customerId ? [{ businessType: BUSINESS_TYPE.CUSTOMER, businessId: lead.customerId }] : []),
        ...(productId ? [{ businessType: BUSINESS_TYPE.PRODUCT, businessId: productId }] : []),
      ],
    },
    100,
  );
}

/** 创建入参（与既有 zod schema 解析后的形状对应；仅列本流程实际使用的字段） */
export interface CreateLeadInput {
  leadName?: string;
  customerId?: string | null;
  channelId?: string | null;
  shopId?: string | null;
  sourceKey?: string | null;
  productId?: string | null;
  quantity?: number;
  source?: 'MANUAL' | 'EXCEL' | 'RPA' | 'SYNC';
  draft?: boolean;
  stage?: number | null;
  customerLocked?: boolean;
  productLocked?: boolean;
  companyName?: string | null;
  contactName?: string | null;
  contactMethods?: { tool: string; account: string }[] | null;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
  productInterest?: string | null;
  productName?: string | null;
  remark?: string | null;
  targetMarket?: string | null;
  currency?: string | null;
  unit?: string | null;
  targetPrice?: string | null;
  expectedDelivery?: string | null;
  customerType?: string | null;
  ownerId?: string | null;
  productDesc?: string | null;
  craftIds?: string[] | null;
  audienceId?: string | null;
  categoryId?: string | null;
  sizeL?: number | null;
  sizeW?: number | null;
  sizeH?: number | null;
  weight?: number | null;
  images?: (string | { url: string; name?: string })[] | null;
}

/**
 * 创建线索。
 *
 * 校验顺序与既有实现逐条一致：来源拆分 → 联系方式必填（draft 放宽）→
 * 产品引用可见性 → 归属人可指派 → 客户引用授权 → 渠道/平台契约 → 事务写入 → 审计。
 */
export async function createLead(data: CreateLeadInput, ctx: LeadActorContext) {
  // 来源拆分：优先组合 sourceKey（{channelId, shopId}），回退显式 channelId/shopId
  const fromSourceKey = splitSourceKey(data.sourceKey);
  const channelId = fromSourceKey.channelId !== undefined ? fromSourceKey.channelId : (data.channelId ?? null);
  const shopId = fromSourceKey.shopId !== undefined ? fromSourceKey.shopId : (data.shopId ?? null);

  // 联系方式：新增线索必须至少一条有效记录；草稿（draft）模式允许为空
  if (!data.draft) {
    if (!data.contactMethods || data.contactMethods.length === 0) {
      throw new DomainValidationError('请至少填写一条联系方式');
    }
  }

  // 名称可选：未传时按「目标国家-产品名称」规则自动生成
  const leadName = data.leadName ?? ([data.targetMarket, data.productName].filter(Boolean).join('-') || '未命名线索');

  // 产品关联落在 LeadItem（Lead 1:N LeadItem），写入时带产品名快照
  let leadItems: LeadItemCreateInput[] | undefined;
  if (data.productId) {
    const productName = await requireVisibleProductName(data.productId, ctx);
    leadItems = [buildLeadItem({ productId: data.productId, productName, data })];
  } else if (data.productName || data.productDesc) {
    leadItems = [buildLeadItem({ productId: null, productName: data.productName ?? null, data })];
  }

  await assertAssignableOwner(data.ownerId, ctx);
  await assertVisibleCustomer(data.customerId, ctx);
  await assertChannelShop(channelId, shopId);

  const item = await createLeadAggregate({
    leadData: {
      leadName,
      customerId: data.customerId ?? null,
      channelId: channelId ?? null,
      shopId: shopId ?? null,
      quantity: data.quantity ?? 0,
      source: data.source ?? 'MANUAL',
      // 新建线索恒为「新线索」：状态推进只发生在绑定商机 / 生成打样单 / 生成订单时
      status: 'NEW',
      companyName: data.companyName ?? null,
      contactName: data.contactName ?? null,
      contactMethods: data.contactMethods ?? undefined,
      email: data.email ?? null,
      phone: data.phone ?? null,
      country: data.country ?? null,
      productInterest: data.productInterest ?? null,
      remark: data.remark ?? null,
      targetMarket: data.targetMarket ?? null,
      currency: data.currency ?? null,
      unit: data.unit ?? null,
      targetPrice: data.targetPrice ?? null,
      // 期望交期按既有口径**原样透传字符串**（Prisma 自行按 ISO-8601 解析，不在此改写）
      expectedDelivery: data.expectedDelivery ?? null,
      customerType: data.customerType ?? null,
      stage: data.stage ?? null,
      draft: data.draft ?? false,
      customerLocked: data.customerLocked ?? false,
      productLocked: data.productLocked ?? false,
      ownerId: data.ownerId ?? null,
      createdBy: ctx.userId ?? null,
    },
    // 汇率快照：创建线索时抓取当日 USD 汇率（与线索币种无关，创建后不再刷新）
    resolveUsdRate,
    items: leadItems,
    attachments: normalizeAttachments(data.images),
    actorUserId: ctx.userId ?? null,
  });

  void activityLogger.log({
    userId: ctx.userId ?? '',
    username: ctx.username ?? '',
    realName: ctx.realName,
    action: 'CREATE',
    module: 'sales',
    businessType: BUSINESS_TYPE.LEAD,
    businessId: item.id,
    businessNo: item.leadNo,
    summary: `创建了线索「${item.leadName || item.leadNo}」`,
    ip: ctx.ip,
    customerId: item.customerId || undefined,
  });

  return item;
}

function buildLeadItem(input: {
  productId: string | null;
  productName: string | null;
  data: CreateLeadInput;
}): LeadItemCreateInput {
  const { data } = input;
  return {
    productId: input.productId,
    productName: input.productName,
    quantity: data.quantity || 1,
    // D2：产品描述落在 LeadItem 明细行
    productDesc: data.productDesc ?? null,
    craftIds: Array.isArray(data.craftIds) ? data.craftIds : [],
    audienceId: data.audienceId ?? null,
    categoryId: data.categoryId ?? null,
    sizeL: data.sizeL ?? null,
    sizeW: data.sizeW ?? null,
    sizeH: data.sizeH ?? null,
    weight: data.weight ?? null,
  };
}

/** 更新的可写标量白名单（与 Prisma Lead 模型逐字段一致） */
export const LEAD_WRITABLE_FIELDS = [
  'leadName',
  'customerId',
  'channelId',
  'shopId',
  'source',
  // status 不在白名单：状态只由单据事件推进（state/leadStatus.state.ts + operations/state.operations.ts）
  'companyName',
  'contactName',
  'contactMethods',
  'email',
  'phone',
  'country',
  'customerType',
  'productInterest',
  'quantity',
  'targetPrice',
  'targetMarket',
  'currency',
  'unit',
  'expectedDelivery',
  'remark',
  'ownerId',
  'stage',
  'draft',
  'customerLocked',
  'productLocked',
] as const;

export interface UpdateLeadInput extends Partial<CreateLeadInput> {
  // 与 CreateLeadInput 一致（partial）
}

/**
 * 更新线索。
 *
 * 校验顺序与既有实现逐条一致：数据范围门 → 归属人可指派 → 客户引用授权 →
 * 来源拆分与渠道/平台契约 → 产品引用可见性 → 主表写入 → 附件整组替换 →
 * LeadItem 明细维护 → 差异与审计。
 */
export async function updateLead(id: string, data: UpdateLeadInput, ctx: LeadActorContext) {
  // V1.0：productId / productName / productDesc 不再属于 Lead 标量，改由 LeadItem 承载
  const { productId, productName, productDesc, ...leadData } = data;

  // 只写入与 Prisma Lead 标量一致的字段（legacy 字段被接受但不落库）
  const update: Record<string, unknown> = {};
  for (const field of LEAD_WRITABLE_FIELDS) {
    if ((leadData as Record<string, unknown>)[field] !== undefined) {
      update[field] = (leadData as Record<string, unknown>)[field];
    }
  }

  // 数据范围门（先于任何写入）；取整行作为 diff 的 before 基准
  const existing = await requireVisibleLead(ctx, id);

  await assertAssignableOwner(leadData.ownerId, ctx);
  await assertVisibleCustomer(leadData.customerId, ctx);

  // 来源渠道/平台：编辑时同样重新校验（先于任何写入）
  const fromSourceKey = splitSourceKey((leadData as Record<string, unknown>).sourceKey as string | undefined);
  if (fromSourceKey.channelId !== undefined) update.channelId = fromSourceKey.channelId;
  if (fromSourceKey.shopId !== undefined) update.shopId = fromSourceKey.shopId;
  const effChannelId =
    (leadData as Record<string, unknown>).channelId !== undefined
      ? (leadData as Record<string, unknown>).channelId as string | null
      : existing.channelId;
  const effShopId =
    (leadData as Record<string, unknown>).shopId !== undefined
      ? (leadData as Record<string, unknown>).shopId as string | null
      : existing.shopId;
  await assertChannelShop(effChannelId, effShopId);

  // 用有效组合值覆盖，确保编辑时来源选择正确落库
  update.channelId = effChannelId ?? null;
  update.shopId = effShopId ?? null;

  // 产品可见性校验必须先于任何写入（含主表更新与明细重建）
  let resolvedProductName: string | null = null;
  if (productId) {
    resolvedProductName = await requireVisibleProductName(productId, ctx);
  }

  // 需求详情扩展字段：仅当显式传入才写，缺失则不覆盖既有值
  const itemExtra: Record<string, unknown> = {};
  if (data.craftIds !== undefined) itemExtra.craftIds = Array.isArray(data.craftIds) ? data.craftIds : [];
  if (data.audienceId !== undefined) itemExtra.audienceId = data.audienceId;
  if (data.categoryId !== undefined) itemExtra.categoryId = data.categoryId;
  if (data.sizeL !== undefined) itemExtra.sizeL = data.sizeL;
  if (data.sizeW !== undefined) itemExtra.sizeW = data.sizeW;
  if (data.sizeH !== undefined) itemExtra.sizeH = data.sizeH;
  if (data.weight !== undefined) itemExtra.weight = data.weight;

  await updateLeadRecord({
    leadId: existing.id,
    update,
    productId,
    productName,
    productDesc,
    resolvedProductName,
    itemExtra,
    quantity: data.quantity,
    // 仅在显式传入 images 时执行「整组替换」；未传则不动附件
    attachmentRows: data.images !== undefined ? normalizeAttachments(data.images) : undefined,
    actorUserId: ctx.userId ?? null,
  });

  // 字段级变更明细 + 审计
  const diff = await computeDiff(
    existing as unknown as Record<string, unknown>,
    { ...(existing as unknown as Record<string, unknown>), ...update },
    { labels: LEAD_DIFF_LABELS, formatters: LEAD_DIFF_FORMATTERS, fields: Object.keys(update) },
  );
  void activityLogger.log({
    userId: ctx.userId ?? '',
    username: ctx.username ?? '',
    realName: ctx.realName,
    action: 'UPDATE',
    module: 'sales',
    businessType: BUSINESS_TYPE.LEAD,
    businessId: existing.id,
    businessNo: existing.leadNo,
    summary: `更新了线索「${existing.leadName || existing.leadNo}」${diff.length ? `（${diff.length} 处变更）` : ''}`,
    diff,
    ip: ctx.ip,
    customerId: typeof update.customerId === 'string' ? update.customerId : undefined,
  });
}

/** 删除线索（仅 admin 可达，路由已鉴权）；日志须在对象删除后仍存活，故删除前取值 */
export async function deleteLead(id: string, ctx: LeadActorContext): Promise<void> {
  const lead = await leadRepository.findUnique({
    where: { id },
    select: { id: true, leadNo: true, leadName: true, customerId: true },
  });
  await leadRepository.delete({ where: { id } });

  if (lead) {
    void activityLogger.log({
      userId: ctx.userId ?? '',
      username: ctx.username ?? '',
      realName: ctx.realName,
      action: 'DELETE',
      module: 'sales',
      businessType: BUSINESS_TYPE.LEAD,
      businessId: lead.id,
      businessNo: lead.leadNo,
      summary: `删除了线索「${lead.leadName || lead.leadNo}」`,
      ip: ctx.ip,
      customerId: lead.customerId || undefined,
    });
  }
}

/** 删除线索参考图片附件（附件须归属该线索且为 LEAD 宿主，杜绝越权删除他人附件） */
export async function deleteLeadAttachment(
  leadId: string,
  attachmentId: string,
  ctx: LeadActorContext,
): Promise<void> {
  const lead = await leadRepository.findFirst({
    where: await scopedWhere(ctx, leadId),
    select: { id: true },
  });
  if (!lead) throw new DomainNotFoundError('线索不存在');

  const att = await attachmentRepository.findOwnedById('LEAD' as AttachmentOwnerType, lead.id, attachmentId);
  if (!att) throw new DomainNotFoundError('附件不存在');

  await attachmentRepository.deleteById(att.id);
}

/**
 * 释放线索（私海 → 公海）。
 *
 * actor 规则不变（owner OR admin）；非本人统一 404「线索不存在」（可见 ≠ 可操作）。
 * Customer / Product 联动必须**独立授权**：无权时**跳过联动**，Lead 释放主操作照常成功。
 * 产品联动在 mutation 时刻重新执行可见性授权（关闭 TOCTOU）。
 */
export async function releaseLead(id: string, ctx: LeadActorContext): Promise<void> {
  const actorUserId = ctx.userId || '';

  const lead = await leadRepository.findFirst({
    where: await scopedWhere(ctx, id),
    include: { items: { select: { productId: true } } },
  });
  if (!lead) throw new DomainNotFoundError('线索不存在');
  if (!lead.ownerId) throw new DomainValidationError('该线索已在公海');
  if (lead.ownerId !== actorUserId && !ctx.isStrictAdmin) throw new DomainNotFoundError('线索不存在');

  // Customer 联动独立授权（仅 Customer owner 或 admin）
  const mutableCustomer = lead.customerId
    ? await customerRepository.findMutableForActor(lead.customerId, actorUserId, ctx.isStrictAdmin)
    : null;
  const releaseCustomerId = mutableCustomer && lead.customerId ? lead.customerId : null;

  // 产品联动按当前可见性重新授权；不可见的产品从 mutation 集合中排除（跳过，不阻断主操作）
  const productIds = lead.items.map((i) => i.productId).filter((v): v is string => Boolean(v));
  let releasedProductIds: string[] = [];
  if (productIds.length) {
    const visibleProducts = await productRepository.findVisibleIds(productIds, ctx.scope.productVisibility());
    releasedProductIds = visibleProducts.map((p) => p.id);
  }

  await releaseLeadOwnership({ leadId: id, releaseCustomerId, releaseProductIds: releasedProductIds });

  await activityLogger.log({
    userId: actorUserId,
    username: ctx.username || '',
    realName: ctx.realName,
    action: 'RELEASE',
    module: 'lead',
    businessType: BUSINESS_TYPE.LEAD,
    businessId: id,
    businessNo: lead.leadNo,
    // 日志只描述**实际发生**的联动（跳过时不得虚报）
    summary: `${ctx.username || ''} 释放该线索到公海${releaseCustomerId ? '，并释放关联客户到公海' : ''}${releasedProductIds.length ? `，关联 ${releasedProductIds.length} 个产品置为公开` : ''}`,
    customerId: lead.customerId || undefined,
  });
}

/**
 * 认领线索（公海 → 私海）。
 *
 * 联动认领客户：仅当客户仍在公海（无归属人）时才归属认领人，避免抢夺他人客户。
 * 联动认领产品：仅当产品无归属人时设为认领人；不可见产品不进入归属改写目标。
 */
export async function claimLead(id: string, ctx: LeadActorContext): Promise<void> {
  const actorUserId = ctx.userId || '';

  const lead = await leadRepository.findUnique({
    where: { id },
    include: { items: { select: { productId: true } } },
  });
  if (!lead) throw new DomainNotFoundError('线索不存在');
  if (lead.ownerId) throw new DomainValidationError('该线索已被认领');

  let claimCustomerId: string | null = null;
  if (lead.customerId) {
    const customer = await customerRepository.findOwnerById(lead.customerId);
    if (customer && !customer.ownerId) claimCustomerId = lead.customerId;
  }

  const productIds = lead.items.map((i) => i.productId).filter((v): v is string => Boolean(v));
  let claimProductIds: string[] = [];
  if (productIds.length) {
    const products = await productRepository.findVisibleOwners(productIds, ctx.scope.productVisibility());
    claimProductIds = products.filter((p) => !p.ownerId).map((p) => p.id);
  }

  await claimLeadOwnership({ leadId: id, claimCustomerId, claimProductIds, userId: actorUserId });

  await activityLogger.log({
    userId: actorUserId,
    username: ctx.username || '',
    realName: ctx.realName,
    action: 'CLAIM',
    module: 'lead',
    businessType: BUSINESS_TYPE.LEAD,
    businessId: id,
    businessNo: lead.leadNo,
    summary: `${ctx.username || ''} 认领了该线索`,
    customerId: lead.customerId || undefined,
  });
}

/**
 * 转交线索（联动客户 / 产品负责人）。
 *
 * actor 规则不变（owner OR admin）。目标 owner 必须同时满足「存在 + 属于调用方数据范围 + ACTIVE」，
 * 且必须在**任何写入之前**完成校验。Customer 联动同样独立授权，无权时跳过。
 */
export async function transferLead(id: string, newOwnerId: string, ctx: LeadActorContext): Promise<void> {
  const actorUserId = ctx.userId || '';

  const lead = await leadRepository.findFirst({
    where: await scopedWhere(ctx, id),
    include: {
      owner: { select: { id: true, realName: true } },
      items: { include: { product: { select: { id: true, visibility: true } } } },
    },
  });
  if (!lead) throw new DomainNotFoundError('线索不存在');
  if (lead.ownerId !== actorUserId && !ctx.isStrictAdmin) throw new DomainNotFoundError('线索不存在');

  const newOwner = await resolveScopedTransferTarget(newOwnerId, ctx.scope);
  if (!newOwner) throw new DomainValidationError('业务归属人不存在或无权限指派');
  if (newOwner.status !== 'ACTIVE') throw new DomainValidationError('目标用户不存在或已停用');

  const oldOwnerName = lead.owner?.realName || '未分配';

  // Customer 联动独立授权（仅 Customer owner 或 admin）；无权时跳过，转交主操作照常成功
  const mutableCustomer = lead.customerId
    ? await customerRepository.findMutableForActor(lead.customerId, actorUserId, ctx.isStrictAdmin)
    : null;
  const transferCustomerId = mutableCustomer && lead.customerId ? lead.customerId : null;

  // 私密产品：在 mutation 时刻按**当前**可见性重新校验（关闭 TOCTOU），不可见者排除
  const privateProductIds = lead.items
    .map((i) => i.product)
    .filter((p) => p && p.visibility === 'PRIVATE')
    .map((p) => p!.id);
  let visibleUserProductIds: string[] = [];
  if (privateProductIds.length) {
    const visibleProducts = await productRepository.findVisibleIds(
      privateProductIds,
      ctx.scope.productVisibility(),
    );
    const visibleIdSet = new Set(visibleProducts.map((p) => p.id));
    visibleUserProductIds = privateProductIds.filter((pid) => visibleIdSet.has(pid));
  }

  await transferLeadOwnership({
    leadId: id,
    transferCustomerId,
    visibleUserProductIds,
    newOwnerId,
  });

  await activityLogger.log({
    userId: actorUserId,
    username: ctx.username || '',
    realName: ctx.realName,
    action: 'TRANSFERRED',
    module: 'lead',
    businessType: BUSINESS_TYPE.LEAD,
    businessId: id,
    businessNo: lead.leadNo,
    summary: `${ctx.username || ''} 将线索从「${oldOwnerName}」转交给「${newOwner.realName || newOwner.username}」${transferCustomerId ? '，并转移关联客户' : ''}${visibleUserProductIds.length ? `，关联 ${visibleUserProductIds.length} 个私密产品加入可见人` : ''}`,
    customerId: lead.customerId || undefined,
  });
}
