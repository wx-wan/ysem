import { ApprovalBizType, ApprovalStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { activityLogger } from '../lib/activity-logger';
import { BUSINESS_TYPE, type BusinessType } from '../lib/business-type';
import {
  DomainConflictError,
  DomainForbiddenError,
  DomainNotFoundError,
  DomainValidationError,
} from '../lib/errors';
import {
  ALL_APPROVAL_BIZ_TYPES,
  approveApprovalOperation,
  loadBusinessRefOperation,
  rejectApprovalOperation,
  scopedBusinessIdsOperation,
  submitApprovalOperation,
  withdrawApprovalOperation,
} from '../operations/approval.operations';
import { approvalConfigRepository, approvalRecordRepository } from '../repositories';

/**
 * ApprovalRecord Business Layer —— Round R-5 · Phase 4 · D3 审批域
 *
 * 审批流水（V1.0 · ApprovalRecord）：`bizType + businessId` **多态旁挂**（无外键）。
 *
 * 【冻结语义（逐字沿用迁移前实现）】
 *   · 单级审批：`level` 恒为 1，审批人集合恒取 `ApprovalConfig.approverIds`；
 *     `flow` / 多级 / ANY-ALL / 金额条件**不参与 runtime**；
 *   · **业务状态隔离**：只操作 `ApprovalRecord.status`，
 *     **绝不修改** Quotation / SampleOrder / SalesOrder / ProductionOrder / Shipment /
 *     PurchaseOrder / Payment / Profit 的业务 status；
 *   · Scope：无 ownerId / 无 relation ⇒ 「按 bizType 分组 → roleScope 求可见业务对象 id 白名单
 *     → ApprovalRecord OR」，不使用公海语义；
 *   · 越权与不存在**同响应**（404 `${label}不存在`），消除存在性 oracle；
 *   · 事务内复检状态（409）避免 TOCTOU；并发重复提交由 DB partial unique index 兜底（P2002 → 409）。
 *
 * 约束：不读 req / res、不出现 `$transaction`、不直接 import Prisma 单例。
 */

/** 调用者上下文（Controller 在 HTTP 边界组装） */
export interface ApprovalActorContext {
  userId?: string;
  username?: string;
  realName?: string;
  ip?: string;
  scope: {
    /** roleScope(req, { field: 'ownerId' }) */
    owner(): Promise<Record<string, unknown>>;
  };
}

/** bizType → 日志/展示元数据（businessType 复用 V1.0 BUSINESS_TYPE，不新增 APPROVAL） */
export const BIZ_META: Record<ApprovalBizType, { businessType: BusinessType; module: string; label: string }> = {
  [ApprovalBizType.QUOTATION]: { businessType: BUSINESS_TYPE.QUOTATION, module: 'quotation', label: '报价单' },
  [ApprovalBizType.SAMPLE_ORDER]: { businessType: BUSINESS_TYPE.SAMPLE_ORDER, module: 'sales', label: '打样单' },
  [ApprovalBizType.SALES_ORDER]: { businessType: BUSINESS_TYPE.SALES_ORDER, module: 'sales', label: '销售订单' },
  [ApprovalBizType.PRODUCTION_ORDER]: { businessType: BUSINESS_TYPE.PRODUCTION_ORDER, module: 'fulfillment', label: '生产工单' },
  [ApprovalBizType.SHIPMENT]: { businessType: BUSINESS_TYPE.SHIPMENT, module: 'fulfillment', label: '出运单' },
  [ApprovalBizType.PURCHASE_ORDER]: { businessType: BUSINESS_TYPE.PURCHASE_ORDER, module: 'fulfillment', label: '采购单' },
  [ApprovalBizType.PAYMENT]: { businessType: BUSINESS_TYPE.PAYMENT, module: 'fulfillment', label: '收付款单' },
  [ApprovalBizType.PROFIT]: { businessType: BUSINESS_TYPE.PROFIT, module: 'fulfillment', label: '利润单' },
};

export const approvalBizTypeSchema = z.nativeEnum(ApprovalBizType);

export const approvalSubmitSchema = z.object({
  bizType: approvalBizTypeSchema,
  businessId: z.string().min(1, '业务单据不能为空'),
});

export const approvalActionSchema = z.object({
  comment: z.string().optional().nullable(),
});

export const approvalListQuerySchema = z.object({
  bizType: approvalBizTypeSchema.optional(),
  status: z.nativeEnum(ApprovalStatus).optional(),
  keyword: z.string().optional(),
  page: z.union([z.string(), z.number()]).optional(),
  pageSize: z.union([z.string(), z.number()]).optional(),
});

export type ApprovalListQuery = z.infer<typeof approvalListQuerySchema>;

// ============================================================
// Scope / 审批人解析
// ============================================================

/** 当前用户对某个业务对象是否有 Scope 权限 */
async function hasBusinessAccess(
  ctx: ApprovalActorContext,
  bizType: ApprovalBizType,
  businessId: string,
): Promise<boolean> {
  const ownerScope = await ctx.scope.owner();
  if (Object.keys(ownerScope).length === 0) return true; // ALL / admin
  const ids = await scopedBusinessIdsOperation(bizType, ownerScope, businessId);
  return ids.length > 0;
}

/** ApprovalConfig.approverIds（JSON 字符串）→ 审批人 id 数组（异常/非法 → 空数组） */
function parseApproverIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  } catch {
    return [];
  }
}

/** 该 bizType 的有效审批人集合（无配置 / 停用 / 配置无审批人 → 400） */
async function resolveApprovers(bizType: ApprovalBizType): Promise<string[]> {
  const config = await approvalConfigRepository.findByBizType(bizType);
  if (!config || !config.enabled) {
    throw new DomainValidationError('该业务类型未配置有效审批流程');
  }
  const approverIds = parseApproverIds(config.approverIds);
  if (approverIds.length === 0) {
    throw new DomainValidationError('该业务类型未配置有效审批流程');
  }
  return approverIds;
}

/** 写 OperationLog（复用具体业务类型，不新增 APPROVAL 业务类型常量；不写 CustomerActivity） */
function logApproval(
  ctx: ApprovalActorContext,
  action: string,
  verb: string,
  record: { bizType: ApprovalBizType; businessId: string; businessNo: string | null },
): void {
  const meta = BIZ_META[record.bizType];
  void activityLogger.log({
    userId: ctx.userId ?? '',
    username: ctx.username ?? '',
    realName: ctx.realName,
    action,
    module: meta.module,
    businessType: meta.businessType,
    businessId: record.businessId,
    businessNo: record.businessNo ?? undefined,
    summary: `${ctx.username ?? ''} ${verb}${meta.label}「${record.businessNo ?? record.businessId}」`,
    ip: ctx.ip,
  });
}

// ============================================================
// 列表 / 详情
// ============================================================

/** 列表（Scope 白名单 OR） */
export async function list(query: ApprovalListQuery, ctx: ApprovalActorContext) {
  const where: Record<string, unknown> = {};
  if (query.bizType) where.bizType = query.bizType;
  if (query.status) where.status = query.status;
  if (query.keyword) where.businessNo = { contains: query.keyword };

  const ownerScope = await ctx.scope.owner();
  if (Object.keys(ownerScope).length > 0) {
    // DEPT / SELF：按 bizType 分组求可见业务对象 id 白名单
    const bizTypes = query.bizType ? [query.bizType] : ALL_APPROVAL_BIZ_TYPES;
    const orConds: Record<string, unknown>[] = [];
    for (const bizType of bizTypes) {
      const ids = await scopedBusinessIdsOperation(bizType, ownerScope);
      if (ids.length > 0) orConds.push({ bizType, businessId: { in: ids } });
    }
    if (orConds.length === 0) {
      return {
        list: [] as unknown[],
        total: 0,
        page: 1,
        pageSize: Number(query.pageSize) || 20,
      };
    }
    where.AND = [{ OR: orConds }];
  }

  const pageNum = Math.max(1, Number(query.page) || 1);
  const pageSizeNum = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
  const whereInput = where as Prisma.ApprovalRecordWhereInput;

  const [list, total] = await Promise.all([
    approvalRecordRepository.findMany({
      where: whereInput,
      orderBy: { submittedAt: 'desc' },
      skip: (pageNum - 1) * pageSizeNum,
      take: pageSizeNum,
    }),
    approvalRecordRepository.count(whereInput),
  ]);
  return { list, total, page: pageNum, pageSize: pageSizeNum };
}

/** 详情（先查记录 → 再按业务对象 owner 校验 Scope；无权 → 403） */
export async function getOne(id: string, ctx: ApprovalActorContext) {
  const record = await approvalRecordRepository.findById(id);
  if (!record) throw new DomainNotFoundError('审批记录不存在');
  const allowed = await hasBusinessAccess(ctx, record.bizType, record.businessId);
  if (!allowed) throw new DomainForbiddenError('无权访问该审批记录');
  return record;
}

// ============================================================
// 流转
// ============================================================

/** 提交审批（按业务单据发起，单级、level=1） */
export async function submit(body: { bizType: ApprovalBizType; businessId: string }, ctx: ApprovalActorContext) {
  // 1. 业务 Scope（禁止越权为他人单据发起审批）；越权与不存在统一 404
  const allowed = await hasBusinessAccess(ctx, body.bizType, body.businessId);
  if (!allowed) throw new DomainNotFoundError(`${BIZ_META[body.bizType].label}不存在`);

  // 2. 业务对象存在性（通过范围判定后，此处失败仅剩「不存在 / 并发删除」）
  const ref = await loadBusinessRefOperation(body.bizType, body.businessId);
  if (!ref) throw new DomainNotFoundError(`${BIZ_META[body.bizType].label}不存在`);

  // 3. 必须有有效审批配置（无配置 / 停用 → 400，不自动放行、不创建记录）
  await resolveApprovers(body.bizType);

  // 4. 防重复 + 建记录（事务在 Operation 层；并发兜底由 DB partial unique index 承担）
  try {
    const record = await submitApprovalOperation({
      bizType: body.bizType,
      businessId: body.businessId,
      businessNo: ref.no,
      submittedBy: ctx.userId ?? null,
    });
    logApproval(ctx, 'SUBMIT', '提交了', record);
    return record;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      // 只输出稳定业务错误，不泄漏 Prisma message / index name / SQL
      throw new DomainConflictError('该业务单据已存在待审批记录');
    }
    throw e;
  }
}

/** 审批通过 */
export async function approve(id: string, comment: string | null | undefined, ctx: ApprovalActorContext) {
  const record = await requirePendingRecord(id, '仅待审批状态可执行审批通过');
  const approverIds = await resolveApprovers(record.bizType);
  if (!ctx.userId || !approverIds.includes(ctx.userId)) {
    throw new DomainForbiddenError('您不是该业务类型的审批人');
  }
  const allowed = await hasBusinessAccess(ctx, record.bizType, record.businessId);
  if (!allowed) throw new DomainForbiddenError('无权操作该业务单据的审批');

  const updated = await approveApprovalOperation(id, ctx.userId, comment);
  logApproval(ctx, 'APPROVE', '审批通过了', updated);
  return updated;
}

/** 审批驳回（comment 必填） */
export async function reject(id: string, comment: string | null | undefined, ctx: ApprovalActorContext) {
  const trimmed = comment?.trim();
  if (!trimmed) throw new DomainValidationError('驳回必须填写审批意见');

  const record = await requirePendingRecord(id, '仅待审批状态可执行驳回');
  const approverIds = await resolveApprovers(record.bizType);
  if (!ctx.userId || !approverIds.includes(ctx.userId)) {
    throw new DomainForbiddenError('您不是该业务类型的审批人');
  }
  const allowed = await hasBusinessAccess(ctx, record.bizType, record.businessId);
  if (!allowed) throw new DomainForbiddenError('无权操作该业务单据的审批');

  const updated = await rejectApprovalOperation(id, ctx.userId, trimmed);
  logApproval(ctx, 'REJECT', '驳回了', updated);
  return updated;
}

/** 撤回（仅提交人） */
export async function withdraw(id: string, comment: string | null | undefined, ctx: ApprovalActorContext) {
  const record = await requirePendingRecord(id, '仅待审批状态可撤回');
  if (!ctx.userId || record.submittedBy !== ctx.userId) {
    throw new DomainForbiddenError('仅提交人可撤回该审批');
  }

  const updated = await withdrawApprovalOperation(id, comment);
  logApproval(ctx, 'WITHDRAW', '撤回了', updated);
  return updated;
}

/**
 * 「仅待审批可流转」的**前置**门。
 * 409 文案按动作区分（approve / reject / withdraw 各不相同），与既有实现逐字一致。
 */
async function requirePendingRecord(id: string, conflictMessage: string) {
  const record = await approvalRecordRepository.findById(id);
  if (!record) throw new DomainNotFoundError('审批记录不存在');
  if (record.status !== ApprovalStatus.PENDING) {
    throw new DomainConflictError(conflictMessage);
  }
  return record;
}
