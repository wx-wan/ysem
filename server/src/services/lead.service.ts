import type { AttachmentOwnerType, LeadStatus, Prisma } from '@prisma/client';
import { activityLogger } from '../lib/activity-logger';
import { BUSINESS_TYPE, type BusinessType } from '../lib/business-type';
import { DomainNotFoundError, DomainValidationError } from '../lib/errors';
import { computeDiff, type FieldFormatter } from '../lib/operation-diff';
import {
  buildLeadListWhere,
  claimLeadOwnership,
  clearLeadDraftNameOperation,
  createLeadAggregate,
  draftCustomerNameKey,
  findAnyCustomerByName,
  findAnyProductByName,
  findCustomerNameOccupier,
  findLeadForLogs,
  findReusableCustomerByName,
  findReusableProductByName,
  loadLeadDetail,
  loadLeadsPage,
  normalizeFilingName,
  refreshLeadCustomerSnapshotOperation,
  releaseLeadOwnership,
  resolveLeadListOrderBy,
  resolveScopedCustomer,
  resolveScopedTransferTarget,
  resolveScopedUser,
  resolveUsdRate,
  resolveVisibleProduct,
  transferLeadOwnership,
  updateLeadAggregate,
  writeLeadDraftSnapshotOperation,
  type LeadCaller,
  type LeadDraftCustomerPatch,
  type LeadProductSnapshotInput,
  type LeadListFilters,
  type LeadScopeProvider,
  type AttachmentCreateInput,
} from '../operations/lead.operations';
import {
  createOpportunity,
  type OpportunityConfirmInput,
  type OpportunityWithInclude,
} from './opportunity.service';
import {
  createCustomerAggregate,
  updateCustomerFromLeadOperation,
} from '../operations/customer.operations';
import {
  createProductOperation,
  updateProductFromLeadOperation,
} from '../operations/product.operations';
import { buildProductCreateData } from './product.service';
import { attachmentRepository } from '../repositories/attachment.repository';
import { channelRepository } from '../repositories/channel.repository';
import { customerRepository } from '../repositories/customer.repository';
import { leadRepository } from '../repositories/lead.repository';
import { operationLogRepository } from '../repositories/operationLog.repository';
import { productRepository } from '../repositories/product.repository';
import type { TxClient } from '../repositories';
import { applyScope, includePublicSea } from '../scope';

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

/**
 * **读取用**可见性：数据范围 ∪ **公海**（`ownerId` 为空）。
 *
 * 公海是共享池（列表「公海」筛选对全员可见、且认领入口就在详情面板），故详情 / 操作记录
 * 必须同样可读 —— 否则「释放到公海后刷新详情」会返回 404「线索不存在」（错误提示）。
 * 注意：**写操作不走本函数**（公海线索只能认领，不能暂存 / 编辑，见 updateLead 的公海门）。
 */
async function scopedWhereReadable(
  ctx: LeadActorContext,
  id: string,
): Promise<Record<string, unknown>> {
  // ⚠️ 必须走 includePublicSea：它会在数据范围为空（管理员 / dataScope=ALL）时**原样返回**，
  //    即不施加归属限制。若写成 `{ OR: [ownerScope, { ownerId: null }] }`，空对象在 OR 中会被
  //    Prisma 丢弃，等价于「只可见公海」，导致管理员打开已归属（如已确认）线索详情返回 404。
  return applyScope({ id }, includePublicSea(await ctx.scope.owner()));
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

/**
 * 字段级差异标签（V1.1：客户 / 产品信息已不再落线索表，
 * 相应标签与格式化器一并移除 —— 那些字段的变更现在发生在 Customer / Product 的日志里）。
 */
const LEAD_DIFF_LABELS: Record<string, string> = {
  leadName: '线索名称',
  customerId: '客户',
  channelId: '来源渠道',
  shopId: '来源平台',
  source: '来源',
  productInterest: '产品意向',
  remark: '备注',
  targetMarket: '目标国家/地区',
  currency: '币种',
  unit: '单位',
  targetPrice: '目标价位',
  usdRate: '创建美元汇率',
  expectedDelivery: '期望交期',
  ownerId: '负责人',
  stage: '步骤',
};

/** 字段值格式化：来源渠道/平台按 ID 解析为名称（联系方式 / 数量已随冗余列下线） */
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

/**
 * 同名客户的**复用范围**（业务规则，非数据范围）：仅「本人 ∪ 公海」，管理员不限。
 *
 * 方案 A：即便调用方数据范围是 `DEPT` / `ALL`，也**不复用他人负责的同名客户** ——
 * 与前端「该客户已由【x】负责」阻断弹窗同口径，杜绝把线索挂到他人客户上。
 */
function reusableCustomerScope(ctx: LeadActorContext): Record<string, unknown> {
  if (ctx.isStrictAdmin) return {};
  return { OR: [{ ownerId: ctx.userId ?? '__no_user__' }, { ownerId: null }] };
}

/**
 * 客户引用授权 + 「归属可复用」门（方案 A 收紧）。
 * 在可见范围之上再要求：该客户**由本人负责或在公海**（管理员不限），
 * 否则拒绝 —— 不允许把线索关联到他人负责的客户。
 */
async function assertReusableCustomer(
  customerId: string | null | undefined,
  ctx: LeadActorContext,
): Promise<void> {
  if (customerId === undefined || customerId === null) return;
  const customer = await resolveScopedCustomer(customerId, ctx.scope);
  if (!customer) throw new DomainValidationError('客户不存在');
  if (ctx.isStrictAdmin) return;
  const ownerId = (customer as { ownerId?: string | null }).ownerId ?? null;
  if (ownerId !== null && ownerId !== ctx.userId) {
    throw new DomainValidationError('该客户已由其他业务员负责，不能用于当前线索');
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
  // 读取可见性含公海：释放后线索归公海仍可查看（否则前端刷新详情会误报「线索不存在」）
  const detail = await loadLeadDetail(await scopedWhereReadable(ctx, id));
  if (!detail) throw new DomainNotFoundError('线索不存在');
  return detail;
}

/**
 * 操作记录：只读 OperationLog 中 businessType=LEAD（+ 关联 CUSTOMER / PRODUCT）的记录，
 * 按时间倒序返回。线索不可见与不存在同响应 404。
 */
export async function getLeadLogs(id: string, ctx: LeadActorContext) {
  const lead = await findLeadForLogs(await scopedWhereReadable(ctx, id));
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

// ============================================================
// V1.1 · FK-Only：事务内「归一匹配 → 复用 / 建档」
// ============================================================

/** 事务内建档结果：外键 + 新建时待补记的审计信息（日志在事务提交后发出） */
interface FilingResult {
  id: string;
  createdLog?: {
    businessType: BusinessType;
    businessId: string;
    businessNo: string;
    module: string;
    summary: string;
  };
}

/** 建档所需的线索级上下文（负责人 + 来源渠道 / 平台 + 本次是否建档） */
interface FilingContext {
  ownerId: string | null;
  channelId: string | null;
  shopId: string | null;
  /**
   * 本次是否「客户信息建档」（`customerLocked`）。
   *
   * **暂存**（false）：**不创建 Customer 行** —— 客户信息只写入线索快照
   * （`customerSnapshot` + `draftCustomerName`），因此**暂存客户不进客户库**；
   * **建档**（true）：才真正在客户库创建正式客户并绑定 `customerId`。
   */
  customerLocked: boolean;
  /**
   * 本次是否「产品信息建档」（`productLocked`）。
   *
   * **未建档**（false）：**不创建产品库记录** —— 产品需求（产品名 / 工艺 / 受众 / 品类 /
   * 长宽高 / 克重）只写进明细快照 `LeadItem.productSnapshot`；
   * **建档**（true）：才真正在产品库创建 / 复用产品并绑定明细的 `productId`。
   */
  productLocked: boolean;
}

/** 参考图片取首张 URL（产品主图 coverImage 为单值列） */
function firstImageUrl(
  images?: (string | { url: string; name?: string })[] | null,
): string | null {
  const first = Array.isArray(images) ? images[0] : null;
  if (!first) return null;
  return typeof first === 'string' ? first : first.url;
}

/**
 * 事务内解析线索的客户关联（客户主数据唯一权威 = Customer）：
 *  1) 显式 `customerId` → 授权校验（owner ∪ 公海 ∪ admin）后直接关联；
 *  2) 归一（trim + 大小写不敏感）命中**可见范围内**既有客户 → 复用（关联既有客户，不新增客户）；
 *  3) 名称已被占用 → 拒绝：正式客户由他人负责，**或他人私海暂存线索已占该名**（暂存即阻塞）；
 *  4) **暂存（未建档）→ 不创建客户**，返回 null，客户信息由调用方写入线索快照（不入客户库）；
 *  5) 建档 → 在同一事务内创建**正式**客户（编号与写入同事务，任一失败全部回滚）。
 */
async function resolveCustomerIdInTx(
  tx: TxClient,
  input: CreateLeadInput,
  filing: FilingContext,
  ctx: LeadActorContext,
  excludeLeadId: string | null,
): Promise<FilingResult | null> {
  if (input.customerId) {
    await assertReusableCustomer(input.customerId, ctx);
    return { id: input.customerId };
  }
  const name = normalizeFilingName(input.companyName);
  if (!name) return null;

  // 复用范围：本人 ∪ 公海（管理员不限）—— 不含他人负责的同名客户
  const reusable = await findReusableCustomerByName(name, reusableCustomerScope(ctx), tx);
  if (reusable) return { id: reusable.id };

  // 占用判定：正式客户 ∪ 他人私海暂存线索（暂存即阻塞）
  const occupier = await findCustomerNameOccupier(name, excludeLeadId, tx);
  if (occupier) {
    throw new DomainValidationError(
      occupier.kind === 'DRAFT'
        ? `客户「${occupier.companyName}」正在由${occupier.ownerName ? `【${occupier.ownerName}】` : '其他业务员'}建档中，该名称已被暂存占用；请更换公司名称或先与对方对齐`
        : `客户「${occupier.companyName}」已由其他业务员负责，不能用于当前线索；如需使用请先由负责人在客户页释放或转交`,
    );
  }

  // 暂存：不建客户（暂存客户不进客户库），客户信息落线索快照
  if (!filing.customerLocked) return null;

  const customer = await createCustomerAggregate(
    {
      companyName: name,
      contactName: input.contactName ?? null,
      contactMethods: (input.contactMethods ?? null) as Prisma.InputJsonValue | undefined,
      email: input.email ?? null,
      phone: input.phone ?? null,
      // 线索「国家/地区」= targetMarket；客户同义字段为 country。
      // 优先显式 country（前端会按国家表转换后提交），缺失时回退 targetMarket
      country: input.country ?? input.targetMarket ?? null,
      customerType: input.customerType ?? null,
      channelId: filing.channelId,
      shopId: filing.shopId,
      source: 'MANUAL',
      ownerId: filing.ownerId,
    },
    tx,
  );
  return {
    id: customer.id,
    createdLog: {
      businessType: BUSINESS_TYPE.CUSTOMER,
      businessId: customer.id,
      businessNo: customer.customerNo,
      module: 'customer',
      summary: `创建客户：${name}`,
    },
  };
}

/** 本次提交是否包含客户信息字段（用于「已关联客户 → 按 id 更新」判定） */
function hasAnyCustomerField(input: {
  companyName?: string | null;
  contactName?: string | null;
  contactMethods?: unknown;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
  targetMarket?: string | null;
  customerType?: string | null;
}): boolean {
  return [
    input.companyName,
    input.contactName,
    input.contactMethods,
    input.email,
    input.phone,
    input.country,
    input.targetMarket,
    input.customerType,
  ].some((v) => v !== undefined);
}

/** 本次提交是否包含产品信息字段（用于「已关联产品 → 按 id 更新」判定） */
function hasAnyProductField(input: {
  productName?: string | null;
  craftIds?: string[] | null;
  audienceId?: string | null;
  categoryId?: string | null;
  sizeL?: number | null;
  sizeW?: number | null;
  sizeH?: number | null;
  weight?: number | null;
}): boolean {
  return [
    input.productName,
    input.craftIds,
    input.audienceId,
    input.categoryId,
    input.sizeL,
    input.sizeW,
    input.sizeH,
    input.weight,
  ].some((v) => v !== undefined);
}

/**
 * 【规则】**已关联客户 → 按 id 更新同一条客户记录**。
 *
 * 建档后线索里改「公司名称 / 联系人 / 联系方式 / 邮箱 / 电话 / 国家地区 / 客户类型」，
 * 都是**修改当前这条客户记录**，绝不再按名复用或新建（避免改名就多出一个客户）。
 * 改名保留重名保护：撞到**其他**客户 → 400（不产生重名客户、不静默合并）。
 * 来源（channelId / shopId）不改动 —— 客户来源为唯一权威，首次确立后不可篡改。
 */
async function syncLinkedCustomerInTx(
  tx: TxClient,
  customerId: string,
  input: {
    companyName?: string | null;
    contactName?: string | null;
    contactMethods?: unknown;
    email?: string | null;
    phone?: string | null;
    country?: string | null;
    targetMarket?: string | null;
    customerType?: string | null;
  },
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (input.companyName !== undefined) {
    const nextName = normalizeFilingName(input.companyName);
    if (!nextName) throw new DomainValidationError('公司名称不能为空');
    const occupied = await findAnyCustomerByName(nextName, tx);
    if (occupied && occupied.id !== customerId) {
      throw new DomainValidationError(
        `客户「${occupied.companyName}」已存在，不能重名；请更换公司名称`,
      );
    }
    patch.companyName = nextName;
  }
  if (input.contactName !== undefined) patch.contactName = input.contactName ?? null;
  if (input.customerType !== undefined) patch.customerType = input.customerType ?? null;
  if (input.contactMethods !== undefined) {
    patch.contactMethods = (input.contactMethods ?? null) as Prisma.InputJsonValue | undefined;
  }
  if (input.email !== undefined) patch.email = input.email ?? null;
  if (input.phone !== undefined) patch.phone = input.phone ?? null;
  // 线索侧「国家/地区」= targetMarket；客户侧同义字段为 country
  const country = input.country !== undefined ? input.country : input.targetMarket;
  if (country !== undefined) patch.country = country ?? null;

  if (Object.keys(patch).length) await updateCustomerFromLeadOperation(customerId, patch, tx);
}

/**
 * 【规则】**已关联产品 → 按 id 更新同一条产品记录**。
 *
 * 建档后线索里改「产品名称 / 尺寸 / 克重」都是修改当前这条产品记录，绝不再新建
 * （避免改名就多出一个产品）。工艺 / 受众 / 品类属产品主数据（影响 SKU 派生），
 * 由产品库维护，不在线索侧改写。
 */
async function syncLinkedProductInTx(
  tx: TxClient,
  productId: string,
  input: {
    productName?: string | null;
    sizeL?: number | null;
    sizeW?: number | null;
    sizeH?: number | null;
    weight?: number | null;
  },
): Promise<void> {
  const patch: {
    name?: string | null;
    sizeL?: number | null;
    sizeW?: number | null;
    sizeH?: number | null;
    weight?: number | null;
  } = {};
  if (input.productName !== undefined) {
    const nextName = normalizeFilingName(input.productName);
    if (!nextName) throw new DomainValidationError('产品名称不能为空');
    // 改名重名保护（与客户同口径）：撞到**其他**产品 → 400，不产生重名产品、不静默合并
    const occupied = await findAnyProductByName(nextName, tx);
    if (occupied && occupied.id !== productId) {
      throw new DomainValidationError(
        `产品「${occupied.name}」已存在，不能重名；请更换产品名称`,
      );
    }
    patch.name = nextName;
  }
  if (input.sizeL !== undefined) patch.sizeL = input.sizeL;
  if (input.sizeW !== undefined) patch.sizeW = input.sizeW;
  if (input.sizeH !== undefined) patch.sizeH = input.sizeH;
  if (input.weight !== undefined) patch.weight = input.weight;

  await updateProductFromLeadOperation(productId, patch, tx);
}

/**
 * 未建档期**产品需求补丁**：只取「本次提交」的产品字段；
 * 全部未提交 → `undefined`（不写空快照、不产生空明细）。
 */
function productSnapshotFromLeadInput(input: {
  productName?: string | null;
  craftIds?: string[] | null;
  audienceId?: string | null;
  categoryId?: string | null;
  sizeL?: number | null;
  sizeW?: number | null;
  sizeH?: number | null;
  weight?: number | null;
}): LeadProductSnapshotInput | undefined {
  const patch: LeadProductSnapshotInput = {
    name: input.productName,
    craftIds: input.craftIds,
    audienceId: input.audienceId,
    categoryId: input.categoryId,
    sizeL: input.sizeL,
    sizeW: input.sizeW,
    sizeH: input.sizeH,
    weight: input.weight,
  };
  return Object.values(patch).some((v) => v !== undefined) ? patch : undefined;
}

/** 暂存期客户信息补丁（由线索输入折算「国家/地区」= country ?? targetMarket） */
function draftPatchFromLeadInput(input: {
  companyName?: string | null;
  contactName?: string | null;
  contactMethods?: unknown;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
  targetMarket?: string | null;
  customerType?: string | null;
}): LeadDraftCustomerPatch {
  return {
    companyName: input.companyName,
    contactName: input.contactName,
    contactMethods: input.contactMethods,
    email: input.email,
    phone: input.phone,
    country: input.country ?? input.targetMarket ?? undefined,
    customerType: input.customerType,
  };
}

/**
 * 事务内确保产品存在（产品主数据唯一权威 = Product），规则与客户一致。
 * 命中既有产品即**仅复用**，不用线索表单里的规格覆盖产品主数据 ——
 * 避免线索侧草稿数据反向污染产品库；产品属性一律在产品模块维护。
 */
async function resolveProductIdInTx(
  tx: TxClient,
  input: CreateLeadInput,
  filing: FilingContext,
  ctx: LeadActorContext,
): Promise<FilingResult | null> {
  if (input.productId) {
    const visible = await resolveVisibleProduct(input.productId, ctx.scope);
    if (!visible) throw new DomainValidationError('产品不存在');
    return { id: input.productId };
  }
  const name = normalizeFilingName(input.productName);
  if (!name) return null;

  const reusable = await findReusableProductByName(name, ctx.scope, tx);
  if (reusable) return { id: reusable.id };

  // 同名占用（与客户同口径）：不在可复用范围内的同名产品（他人负责）→ 拒绝，
  // 杜绝产生仅大小写 / 空白差异的重名产品（既不新建，也不静默合并到他人的产品）。
  const occupied = await findAnyProductByName(name, tx);
  if (occupied) {
    throw new DomainValidationError(
      `产品「${occupied.name}」已由其他业务员负责，不能用于当前线索；如需使用请先由负责人在产品页释放或转交`,
    );
  }

  // 【规则】产品未建档 → **不创建产品库记录**：产品需求以明细快照承载
  // （见 `updateLeadRecord` / `createLeadAggregate` 的 productSnapshot 写入），建档时才落产品库。
  if (!filing.productLocked) return null;

  const craftIds = Array.isArray(input.craftIds) ? input.craftIds : [];
  const audienceId = input.audienceId ?? null;
  const data = await buildProductCreateData(
    {
      name,
      craftIds,
      audienceId,
      categoryId: input.categoryId ?? null,
      sizeL: input.sizeL ?? null,
      sizeW: input.sizeW ?? null,
      sizeH: input.sizeH ?? null,
      weight: input.weight ?? null,
      images: firstImageUrl(input.images),
    },
    { userId: ctx.userId, roleCode: ctx.roleCode },
  );
  const product = await createProductOperation(
    {
      // ownerId 与线索负责人对齐：claim / transfer / release 的联动口径保持一致
      data: { ...data, ownerId: filing.ownerId },
      craftIds,
      audienceId,
      hasFullContext: Boolean(craftIds.length && audienceId),
    },
    tx,
  );
  return {
    id: product.id,
    createdLog: {
      businessType: BUSINESS_TYPE.PRODUCT,
      businessId: product.id,
      businessNo: product.productNo,
      module: 'product',
      summary: `创建了产品「${product.name}」`,
    },
  };
}

/** 事务提交后补记主数据建档日志（放在事务外，避免回滚残留孤儿日志） */
function flushFilingLogs(logs: (FilingResult['createdLog'] | undefined)[], ctx: LeadActorContext): void {
  for (const l of logs) {
    if (!l) continue;
    void activityLogger.log({
      userId: ctx.userId ?? '',
      username: ctx.username ?? '',
      realName: ctx.realName,
      action: 'CREATE',
      module: l.module,
      businessType: l.businessType,
      businessId: l.businessId,
      businessNo: l.businessNo,
      summary: l.summary,
      ip: ctx.ip,
    });
  }
}

/**
 * **归属不变量**：客户由谁负责，线索的负责人就是谁。
 *
 *  - 客户有负责人 X → 线索负责人恒为 X（请求里的 ownerId 被覆盖，不允许出现「线索挂 A、客户挂 B」）
 *  - 客户在公海（无负责人）→ 以线索负责人**认领该客户**（客户 ownerId := 线索负责人），
 *    使不变量在公海场景同样成立（与既有 claim / transfer 的客户联动同向）
 *  - 未关联客户 → 负责人不受约束，沿用请求值
 *
 * 说明：非管理员经「方案 A」只能关联本人 / 公海客户，故推导结果必在可指派范围内；
 * 管理员数据范围为全部，客户负责人已是权威归属，无需再校验可指派性。
 */
async function resolveOwnerForLeadInTx(
  tx: TxClient,
  customerId: string | null,
  requestedOwnerId: string | null,
  ctx: LeadActorContext,
): Promise<string | null> {
  if (!customerId) return requestedOwnerId;
  const customer = await customerRepository.findOwnerById(customerId, tx);
  if (!customer) return requestedOwnerId;
  if (customer.ownerId) return customer.ownerId;

  // 公海客户：随线索一起归入线索负责人名下
  const owner = requestedOwnerId ?? ctx.userId ?? null;
  if (owner) await customerRepository.updateOwner(customerId, owner, tx);
  return owner;
}

/**
 * **来源不变量**：一个客户只有一种来源 —— 线索的来源渠道恒等于其客户的来源。
 *
 *  - 客户已有来源 → 线索**恒取客户来源**（请求里不一致的 channelId/shopId 被覆盖，
 *    不允许出现「同一客户的两条线索来源不同」，也避免前端残留旧值落库）
 *  - 客户尚无来源 + 本次提供了来源 → 以该来源**确立客户的唯一来源**（写入客户档案）
 *  - 客户尚无来源 + 本次也未提供 → 显式清空线索来源，避免陈旧值残留
 *  - 未关联客户 → 来源不受约束，沿用请求值（新建客户场景由建档流程一并写入客户）
 *
 * 返回 `undefined` = 不改动（沿用请求值）。
 */
async function resolveSourceForLeadInTx(
  tx: TxClient,
  customerId: string | null,
  requested: { channelId: string | null; shopId: string | null },
): Promise<{ channelId: string | null; shopId: string | null } | undefined> {
  if (!customerId) return undefined;
  const customer = await customerRepository.findChannelById(customerId, tx);
  if (!customer) return undefined;

  if (customer.channelId) {
    // 客户来源为唯一权威：线索一律跟随（含客户有渠道但无平台的情形）
    return { channelId: customer.channelId, shopId: customer.shopId ?? null };
  }
  if (requested.channelId) {
    // 客户尚无来源：由本次线索确立，写回客户档案（此后该客户所有线索都取此来源）
    await customerRepository.updateChannel(customerId, requested.channelId, requested.shopId, tx);
    return { channelId: requested.channelId, shopId: requested.shopId };
  }
  return { channelId: null, shopId: null };
}

/**
 * 创建线索（V1.1 · FK-Only）。
 *
 * 校验顺序（沿用既有口径）：来源拆分 → 联系方式必填（draft 放宽）→
 * 归属人可指派 → 渠道/平台契约 → **事务内建档 + 写入** → 审计。
 *
 * 建档与线索写入同一事务：客户 / 产品 / 线索三者原子，任一失败全部回滚。
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

  await assertAssignableOwner(data.ownerId, ctx);
  await assertChannelShop(channelId, shopId);

  const filing: FilingContext = {
    // 生效负责人：显式指定优先；**暂存（draft）线索未指定时归创建人**（公海不支持暂存，
    // 详见 resolveOwnerId 同口径取值）——不占用名键 / 建档主数据归属都以此为准。
    ownerId: data.ownerId ?? (data.draft ? (ctx.userId ?? null) : null),
    channelId: channelId ?? null,
    shopId: shopId ?? null,
    customerLocked: data.customerLocked ?? false,
    productLocked: data.productLocked ?? false,
  };
  const pendingLogs: (FilingResult['createdLog'] | undefined)[] = [];

  const item = await createLeadAggregate({
    leadData: {
      leadName,
      channelId: channelId ?? null,
      shopId: shopId ?? null,
      source: data.source ?? 'MANUAL',
      // 新建线索恒为「新线索」：状态推进只发生在绑定商机 / 生成打样单 / 生成订单时
      status: 'NEW',
      productInterest: data.productInterest ?? null,
      remark: data.remark ?? null,
      targetMarket: data.targetMarket ?? null,
      currency: data.currency ?? null,
      unit: data.unit ?? null,
      targetPrice: data.targetPrice ?? null,
      // 期望交期按既有口径**原样透传字符串**（Prisma 自行按 ISO-8601 解析，不在此改写）
      expectedDelivery: data.expectedDelivery ?? null,
      stage: data.stage ?? null,
      draft: data.draft ?? false,
      customerLocked: data.customerLocked ?? false,
      productLocked: data.productLocked ?? false,
      ownerId: data.ownerId ?? null,
      createdBy: ctx.userId ?? null,
    },
    // 汇率快照：创建线索时抓取当日 USD 汇率（与线索币种无关，创建后不再刷新）
    resolveUsdRate,
    quantity: data.quantity || 1,
    // 线索级「客户具体要求」（非产品主数据副本）
    productDesc: data.productDesc ?? null,
    // 未建档期的产品需求（有产品外键时操作层忽略，改以产品档案留痕）
    productSnapshot: productSnapshotFromLeadInput(data),
    attachments: normalizeAttachments(data.images),
    actorUserId: ctx.userId ?? null,
    resolveCustomerId: async (tx) => {
      const r = await resolveCustomerIdInTx(tx, data, filing, ctx, null);
      pendingLogs.push(r?.createdLog);
      return r?.id ?? null;
    },
    resolveProductId: async (tx) => {
      const r = await resolveProductIdInTx(tx, data, filing, ctx);
      pendingLogs.push(r?.createdLog);
      return r?.id ?? null;
    },
    // 归属不变量：客户由谁负责，线索负责人就是谁。
    // 另：【规则】公海不支持暂存 → 暂存（draft）线索必须有负责人，未指定时归创建人，
    // 避免产生「公海里的暂存线索」（那种线索既无人负责、又占着客户名）。
    resolveOwnerId: (tx, customerId) =>
      resolveOwnerForLeadInTx(
        tx,
        customerId,
        data.ownerId ?? (data.draft ? (ctx.userId ?? null) : null),
        ctx,
      ),
    // 来源不变量：一个客户只有一种来源（线索来源恒等于客户来源）
    resolveSource: (tx, customerId) =>
      resolveSourceForLeadInTx(tx, customerId, { channelId: channelId ?? null, shopId: shopId ?? null }),
    // 客户快照：有关联客户 → 以客户档案为源；暂存（无客户）→ 以线索输入为源
    // （暂存期客户信息的**唯一载体**就是快照，故暂存创建也必须写）
    afterWrite: async (tx, leadId, customerId) => {
      if (customerId) {
        await refreshLeadCustomerSnapshotOperation(leadId, customerId, tx);
        return;
      }
      if (!filing.customerLocked) {
        await writeLeadDraftSnapshotOperation(
          leadId,
          {
            ...draftPatchFromLeadInput(data),
            ownerId: filing.ownerId,
            channelId: filing.channelId,
            shopId: filing.shopId,
          },
          tx,
        );
      }
    },
  });

  flushFilingLogs(pendingLogs, ctx);

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

/** 更新的可写标量白名单（与 Prisma Lead 模型逐字段一致） */
export const LEAD_WRITABLE_FIELDS = [
  'leadName',
  'customerId',
  'channelId',
  'shopId',
  'source',
  // status 不在白名单：状态只由单据事件推进（state/leadStatus.state.ts + operations/state.operations.ts）
  // V1.1：客户类 7 列（companyName/contactName/contactMethods/email/phone/country/customerType）
  // 与 quantity 已下线 —— 客户信息经 customerId 关联 Customer，数量落在 LeadItem.quantity。
  'productInterest',
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
 * 更新线索（V1.1 · FK-Only）。
 *
 * 校验顺序（沿用既有口径）：数据范围门 → 归属人可指派 → 来源拆分与渠道/平台契约 →
 * 客户/产品引用校验（**事务内建档 + 复用**）→ 主表写入 → 附件整组替换 →
 * LeadItem 明细维护 → 差异与审计。
 *
 * 语义约定：**未提交公司名 / 产品名时不得清空既有外键关联**；显式传
 * `customerId: null` / `productId: null` 才表示解除关联。
 */
export async function updateLead(id: string, data: UpdateLeadInput, ctx: LeadActorContext) {
  // V1.1：productDesc 仍属 LeadItem（线索级「客户具体要求」），从 Lead 标量入参中剥离
  const { productId, productName, productDesc, ...leadData } = data;

  // 只写入与 Prisma Lead 标量一致的字段（客户类冗余列与 quantity 已下线，将被忽略）
  const update: Record<string, unknown> = {};
  for (const field of LEAD_WRITABLE_FIELDS) {
    if ((leadData as Record<string, unknown>)[field] !== undefined) {
      update[field] = (leadData as Record<string, unknown>)[field];
    }
  }

  // 数据范围门（先于任何写入）；取整行作为 diff 的 before 基准
  const existing = await requireVisibleLead(ctx, id);

  // 【规则】公海线索**只支持认领，不支持暂存 / 编辑**：未认领（ownerId 为空）的线索
  // 必须先认领成为负责人才能编辑；管理员按既有口径放行。
  // 注：本规则只针对**公海**；他人私海线索仍沿既有「数据范围可见即可编辑」口径（不改动）。
  if (!existing.ownerId && !ctx.isStrictAdmin) {
    throw new DomainValidationError('该线索在公海，请先认领后再编辑或暂存');
  }

  await assertAssignableOwner(leadData.ownerId, ctx);

  // 来源渠道/平台：编辑时同样重新校验（先于任何写入）
  const fromSourceKey = splitSourceKey((leadData as Record<string, unknown>).sourceKey as string | undefined);
  if (fromSourceKey.channelId !== undefined) update.channelId = fromSourceKey.channelId;
  if (fromSourceKey.shopId !== undefined) update.shopId = fromSourceKey.shopId;
  // 有效来源 = 本次显式 channelId/shopId（已并入 update）> 本次 sourceKey 组合（同上）> 既有值。
  // 修正：原实现只读 `leadData.channelId/shopId`，漏掉 sourceKey，且随后用 eff* 覆盖 update，
  // 导致「编辑时改用 sourceKey 提交的来源不生效」（前端正是以 sourceKey 提交）。
  const effChannelId =
    update.channelId !== undefined ? (update.channelId as string | null) : existing.channelId;
  const effShopId =
    update.shopId !== undefined ? (update.shopId as string | null) : existing.shopId;
  await assertChannelShop(effChannelId, effShopId);

  // 用有效组合值覆盖，确保编辑时来源选择正确落库
  update.channelId = effChannelId ?? null;
  update.shopId = effShopId ?? null;

  // 建档上下文取「更新后的有效值」，保证新建客户 / 产品的归属与来源与线索一致
  const effOwnerId =
    (leadData as Record<string, unknown>).ownerId !== undefined
      ? ((leadData as Record<string, unknown>).ownerId as string | null)
      : existing.ownerId;
  // 本次生效的「客户信息是否已建档」：未提交则沿用既有值
  const effCustomerLocked =
    (leadData as Record<string, unknown>).customerLocked !== undefined
      ? Boolean((leadData as Record<string, unknown>).customerLocked)
      : existing.customerLocked;
  // 本次生效的「产品信息是否已建档」：未提交则沿用既有值
  const effProductLocked =
    (leadData as Record<string, unknown>).productLocked !== undefined
      ? Boolean((leadData as Record<string, unknown>).productLocked)
      : existing.productLocked;
  const filing: FilingContext = {
    ownerId: effOwnerId ?? null,
    channelId: effChannelId ?? null,
    shopId: effShopId ?? null,
    customerLocked: effCustomerLocked,
    productLocked: effProductLocked,
  };
  // 快照可写性：线索仍处于「未确认」（NEW）才继续刷新客户 / 产品快照，确认后冻结
  const snapshotMutable =
    existing.status === 'NEW' &&
    (((leadData as Record<string, unknown>).status as LeadStatus | undefined) ?? existing.status) ===
      'NEW';

  // 客户关联：显式 customerId 优先（null = 解除关联）；否则按公司名归一匹配 / 建档；两者皆无 → 不改动
  const hasExplicitCustomer = (leadData as Record<string, unknown>).customerId !== undefined;
  const hasCompanyName = data.companyName !== undefined;

  // 产品关联：显式 productId 优先（null = 解除关联）；否则按产品名归一匹配 / 建档；两者皆无 → 不改动
  const hasExplicitProduct = productId !== undefined;
  const hasProductName = productName !== undefined;

  const pendingLogs: (FilingResult['createdLog'] | undefined)[] = [];

  await updateLeadAggregate({
    leadId: existing.id,
    update,
    productDesc,
    quantity: data.quantity,
    // 未建档期的产品需求：本次提交的字段合并进明细快照（有产品外键时改以产品档案刷新）
    productSnapshotPatch: productSnapshotFromLeadInput(data),
    // 与客户快照同口径：线索**已确认**（CONFIRMED 及之后）后快照冻结，不再刷新
    productSnapshotMutable: snapshotMutable,
    // 仅在显式传入 images 时执行「整组替换」；未传则不动附件
    attachmentRows: data.images !== undefined ? normalizeAttachments(data.images) : undefined,
    actorUserId: ctx.userId ?? null,
    resolveCustomerId: async (tx) => {
      if (hasExplicitCustomer) {
        const explicit = (leadData as Record<string, unknown>).customerId as string | null;
        // 已关联**同一**客户 → 沿用既有可见性口径（避免重开旧线索被新规则卡死）；
        // 改为关联**其他**客户 → 必须满足「本人 / 公海 / 管理员」
        if (explicit && explicit !== existing.customerId) await assertReusableCustomer(explicit, ctx);
        else await assertVisibleCustomer(explicit, ctx);
        // 关联既有客户 → 不再占用暂存名（占用改由正式客户承载）
        if (explicit) await clearLeadDraftNameOperation(existing.id, tx);
        return explicit ?? null;
      }
      // 【规则】已关联客户 → **按 id 更新同一条客户记录**（改公司名 / 联系人 / 联系方式都是改这一条），
      // 不再走「按名复用 / 新建」，避免改名就多出一个客户。
      if (existing.customerId && hasAnyCustomerField(data)) {
        await syncLinkedCustomerInTx(tx, existing.customerId, data);
        return existing.customerId;
      }

      // 暂存期客户信息的唯一载体是快照：建档（或本次提交部分客户字段）时，
      // 本次未提交的字段一律回退取快照，避免建出一个「只有公司名」的空客户。
      const snapshotDraft = (existing.customerSnapshot ?? null) as Record<string, unknown> | null;
      const fromSnapshotOr = <T>(submitted: T | undefined, key: string): T | undefined =>
        submitted !== undefined ? submitted : ((snapshotDraft?.[key] ?? undefined) as T | undefined);

      if (!hasCompanyName) {
        // 本次未提交公司名：仅当「由暂存转为建档」且快照里带着客户信息时才继续（用快照建档）
        const draftName = normalizeFilingName(snapshotDraft?.companyName as string | null | undefined);
        if (!(effCustomerLocked && !existing.customerId && draftName)) return undefined;
      }

      // 暂存 → 不建客户（信息落快照）；建档 → 创建正式客户；
      // 两种情况都执行「暂存即阻塞」占用检查（正式客户 ∪ 他人私海暂存名）
      const r = await resolveCustomerIdInTx(
        tx,
        {
          companyName: hasCompanyName
            ? data.companyName
            : (snapshotDraft?.companyName as string | null | undefined),
          contactName: fromSnapshotOr(data.contactName, 'contactName'),
          contactMethods: fromSnapshotOr(data.contactMethods, 'contactMethods'),
          email: fromSnapshotOr(data.email, 'email'),
          phone: fromSnapshotOr(data.phone, 'phone'),
          country: fromSnapshotOr(data.country, 'country'),
          customerType: fromSnapshotOr(data.customerType, 'customerType'),
        },
        filing,
        ctx,
        existing.id,
      );
      pendingLogs.push(r?.createdLog);
      if (r?.id) await clearLeadDraftNameOperation(existing.id, tx);
      return r?.id ?? null;
    },
    // 归属不变量：客户由谁负责，线索负责人就是谁（本次未改动客户时按既有客户回退）
    resolveOwnerId: (tx, customerId) => {
      const effCustomerId = customerId === undefined ? (existing.customerId ?? null) : customerId;
      if (!effCustomerId) return Promise.resolve(undefined);
      return resolveOwnerForLeadInTx(tx, effCustomerId, effOwnerId ?? null, ctx);
    },
    // 来源不变量：一个客户只有一种来源（本次未改动客户时按既有客户回退）
    resolveSource: (tx, customerId) => {
      const effCustomerId = customerId === undefined ? (existing.customerId ?? null) : customerId;
      if (!effCustomerId) return Promise.resolve(undefined);
      return resolveSourceForLeadInTx(tx, effCustomerId, {
        channelId: effChannelId ?? null,
        shopId: effShopId ?? null,
      });
    },
    /**
     * 客户快照：**未确认期间每次线索更新同步刷新**；**确认（CONFIRMED 及之后）后冻结**。
     * 生效状态取「本次提交的 status ?? 既有 status」——一旦任一侧已确认即不再改动。
     * 来源随阶段切换：有关联客户 → 客户档案；暂存（无客户）→ 线索输入（合并既有快照）。
     */
    afterResolve: async (tx, customerId) => {
      const effStatus =
        ((leadData as Record<string, unknown>).status as LeadStatus | undefined) ?? existing.status;
      if (existing.status !== 'NEW' || effStatus !== 'NEW') return;

      const effCustomerId = customerId === undefined ? (existing.customerId ?? null) : customerId;
      if (effCustomerId) {
        await refreshLeadCustomerSnapshotOperation(existing.id, effCustomerId, tx);
        return;
      }
      // 暂存期：以线索输入刷新草稿快照，并同步维护暂存占用键
      if (!effCustomerLocked) {
        await writeLeadDraftSnapshotOperation(
          existing.id,
          {
            ...draftPatchFromLeadInput(data),
            ownerId: effOwnerId ?? null,
            channelId: effChannelId ?? null,
            shopId: effShopId ?? null,
          },
          tx,
        );
      }
    },
    resolveProductId: async (tx) => {
      if (hasExplicitProduct) {
        const visible = productId ? await resolveVisibleProduct(productId, ctx.scope) : null;
        if (productId && !visible) throw new DomainValidationError('产品不存在');
        return productId ?? null;
      }
      // 当前明细（含已关联产品外键与未建档产品需求快照）
      const currentItem = await leadRepository.items.findFirstByLead(existing.id, tx);

      // 【规则】已关联产品 → **按 id 更新同一条产品记录**（改产品名 / 尺寸 / 克重都是改这一条），
      // 不再走「按名复用 / 新建」，避免改名就多出一个产品。
      if (currentItem?.productId && hasAnyProductField(data)) {
        await syncLinkedProductInTx(tx, currentItem.productId, data);
        return currentItem.productId;
      }

      // 产品需求在未建档期**只存在明细快照里**：建档（或本次提交部分产品字段）时，
      // 本次未提交的字段一律回退取快照，避免建出一个「只有产品名」的空产品。
      const snapshotProduct = (currentItem?.productSnapshot ?? null) as Record<string, unknown> | null;
      const fromSnapshot = <T>(submitted: T | undefined, key: string): T | undefined =>
        submitted !== undefined ? submitted : ((snapshotProduct?.[key] ?? undefined) as T | undefined);

      const effProductName = hasProductName
        ? productName
        : (snapshotProduct?.name as string | null | undefined);
      // 本次未提交产品名：仅当「由未建档转为建档」且快照里带着产品需求时才继续（用快照建档）
      if (!hasProductName && !(effProductLocked && !currentItem?.productId)) return undefined;
      if (!normalizeFilingName(effProductName)) return undefined;

      const r = await resolveProductIdInTx(
        tx,
        {
          productName: effProductName,
          craftIds: fromSnapshot(data.craftIds, 'craftIds'),
          audienceId: fromSnapshot(data.audienceId, 'audienceId'),
          categoryId: fromSnapshot(data.categoryId, 'categoryId'),
          sizeL: fromSnapshot(data.sizeL, 'sizeL'),
          sizeW: fromSnapshot(data.sizeW, 'sizeW'),
          sizeH: fromSnapshot(data.sizeH, 'sizeH'),
          weight: fromSnapshot(data.weight, 'weight'),
        },
        filing,
        ctx,
      );
      pendingLogs.push(r?.createdLog);
      return r?.id ?? null;
    },
  });

  flushFilingLogs(pendingLogs, ctx);

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
 * 确认线索 → 创建商机（**商机的唯一创建入口**）。
 *
 * 【规则】商机不支持创建，只可由线索创建：
 *   · 客户与来源线索一律由**线索自身**派生（不采信入参的 customerId / leadId）；
 *   · 有权操作该线索者才能确认（负责人或管理员），非本人统一 404「线索不存在」（可见 ≠ 可操作）；
 *   · 线索未关联客户 → 400「客户不能为空」（与既有错误语义保持一致）；
 *   · 创建成功后由商机服务推进线索状态为「已确认」（状态只进不退）。
 */
export async function confirmLeadToOpportunity(
  id: string,
  body: OpportunityConfirmInput,
  ctx: LeadActorContext,
): Promise<OpportunityWithInclude> {
  const actorUserId = ctx.userId || '';

  const lead = await leadRepository.findFirst({
    where: await scopedWhere(ctx, id),
    select: { id: true, ownerId: true, customerId: true },
  });
  if (!lead) throw new DomainNotFoundError('线索不存在');
  if (lead.ownerId !== actorUserId && !ctx.isStrictAdmin) throw new DomainNotFoundError('线索不存在');
  if (!lead.customerId) throw new DomainValidationError('客户不能为空');

  return createOpportunity({ ...body, customerId: lead.customerId, leadId: lead.id }, ctx);
}

/**
 * 释放线索（私海 → 公海）。
 *
 * actor 规则不变（owner OR admin）；非本人统一 404「线索不存在」（可见 ≠ 可操作）。
 *
 * 【规则 1】**线索放弃到公海 ⇒ 关联客户必然一并放归公海**（不再是「可选联动」）。
 * 依据归属不变量「客户由谁负责，线索的负责人就是谁」：能操作该线索者即客户负责人，
 * 故释放客户天然具备授权；若遇到历史数据归属不一致（客户由他人负责），
 * 则**拒绝释放**，避免越权改动他人客户。
 *
 * 【规则 2】**关联产品同样强制联动**：不论可见性一律置公开并清空负责人。
 * 注意副作用：该产品可能同时被其他线索 / 商机引用，置公开会影响这些引用方的可见性与归属。
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

  // 客户必随之放归公海：先核对归属一致性（客户已在公海 → 幂等；归本人 → 正常；管理员 → 放行）
  let releaseCustomerId: string | null = null;
  if (lead.customerId) {
    const customer = await customerRepository.findOwnerById(lead.customerId);
    const customerOwnerId = customer?.ownerId ?? null;
    if (customerOwnerId === null || customerOwnerId === actorUserId || ctx.isStrictAdmin) {
      releaseCustomerId = lead.customerId;
    } else {
      throw new DomainValidationError(
        '该线索关联客户的负责人与线索负责人不一致，请先对齐客户归属后再释放',
      );
    }
  }

  // 产品强制联动（规则）：关联产品一律置公开并清空负责人，**不按可见性筛选**
  // （与客户同规格：线索放弃即把关联资产整体放归公共池，避免「线索走了、产品还挂在私人名下」）
  const releasedProductIds = [
    ...new Set(lead.items.map((i) => i.productId).filter((v): v is string => Boolean(v))),
  ];

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
    summary: `${ctx.username || ''} 释放该线索到公海${releaseCustomerId ? '，关联客户一并放归公海' : ''}${releasedProductIds.length ? `，关联 ${releasedProductIds.length} 个产品置为公开` : ''}`,
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

  // 认领时重新登记「暂存客户」占名键：仅限未建档（客户信息只在线索快照）且有公司名的线索
  // —— 公海不占名（释放时已清），认领成为负责人后才恢复占名。
  const draftNameKey =
    !lead.customerId && !lead.customerLocked
      ? draftCustomerNameKey(
          (lead.customerSnapshot as { companyName?: string | null } | null)?.companyName,
        )
      : null;

  await claimLeadOwnership({
    leadId: id,
    claimCustomerId,
    claimProductIds,
    userId: actorUserId,
    draftNameKey,
  });

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
