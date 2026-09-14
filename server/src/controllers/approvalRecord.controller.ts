import { Response } from 'express';
import { z } from 'zod';
import { ApprovalBizType, ApprovalStatus, Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';
import { applyScope, roleScope } from '../utils/scope';
import { activityLogger } from '../lib/activity-logger';
import { BUSINESS_TYPE, BusinessType } from '../lib/business-type';

// ============================================================
// 审批流水（V1.0 · ApprovalRecord）
//
//  - ApprovalRecord 为**多态旁挂**：`bizType + businessId`，**无外键**；
//    因此业务对象一律在 application layer 按 bizType 查表（禁止臆测 Prisma relation）。
//  - 业务类型只允许冻结的 8 个值；**QUALITY_INSPECTION 不在 enum 中 → 400**。
//  - 单级审批：`level` 恒为 1，审批人集合恒取 `ApprovalConfig.approverIds`；
//    `flow` / 多级 / ANY-ALL / 金额条件**不参与 runtime**。
//  - **业务状态隔离**：本 runtime 只操作 `ApprovalRecord.status`，
//    绝不修改 Quotation / SampleOrder / SalesOrder / ProductionOrder / Shipment /
//    PurchaseOrder / Payment / Profit 的业务 status。
//  - Scope：ApprovalRecord 无 ownerId、无 relation → 采用
//    「按 bizType 分组 → roleScope 查可见业务对象 id 白名单 → ApprovalRecord OR」策略，
//    **不修改 utils/scope.ts**，不使用公海语义。
//
// 已 Deferred：
//  - 多级审批 runtime（flow / level > 1 / ANY-ALL）
//  - 按金额 / 条件匹配审批
//  - 业务 status 自动联动
//  - QUALITY_INSPECTION 审批（ApprovalBizType 无该值，需扩 enum）
//  - CustomerActivity（本 runtime 只落 OperationLog）
//  - 并发竞态根治（schema 无 unique constraint，见 Risks）
// ============================================================

/** bizType → 日志/展示元数据（businessType 复用 V1.0 BUSINESS_TYPE，不新增 APPROVAL） */
const BIZ_META: Record<ApprovalBizType, { businessType: BusinessType; module: string; label: string }> = {
  [ApprovalBizType.QUOTATION]: {
    businessType: BUSINESS_TYPE.QUOTATION,
    module: 'quotation',
    label: '报价单',
  },
  [ApprovalBizType.SAMPLE_ORDER]: {
    businessType: BUSINESS_TYPE.SAMPLE_ORDER,
    module: 'sales',
    label: '打样单',
  },
  [ApprovalBizType.SALES_ORDER]: {
    businessType: BUSINESS_TYPE.SALES_ORDER,
    module: 'sales',
    label: '销售订单',
  },
  [ApprovalBizType.PRODUCTION_ORDER]: {
    businessType: BUSINESS_TYPE.PRODUCTION_ORDER,
    module: 'fulfillment',
    label: '生产工单',
  },
  [ApprovalBizType.SHIPMENT]: {
    businessType: BUSINESS_TYPE.SHIPMENT,
    module: 'fulfillment',
    label: '出运单',
  },
  [ApprovalBizType.PURCHASE_ORDER]: {
    businessType: BUSINESS_TYPE.PURCHASE_ORDER,
    module: 'fulfillment',
    label: '采购单',
  },
  [ApprovalBizType.PAYMENT]: {
    businessType: BUSINESS_TYPE.PAYMENT,
    module: 'fulfillment',
    label: '收付款单',
  },
  [ApprovalBizType.PROFIT]: {
    businessType: BUSINESS_TYPE.PROFIT,
    module: 'fulfillment',
    label: '利润单',
  },
};

/** 冻结的 8 个业务类型（显式列举，确保不引入 QUALITY_INSPECTION） */
const ALL_BIZ_TYPES: ApprovalBizType[] = [
  ApprovalBizType.QUOTATION,
  ApprovalBizType.SAMPLE_ORDER,
  ApprovalBizType.SALES_ORDER,
  ApprovalBizType.PRODUCTION_ORDER,
  ApprovalBizType.SHIPMENT,
  ApprovalBizType.PURCHASE_ORDER,
  ApprovalBizType.PAYMENT,
  ApprovalBizType.PROFIT,
];

const bizTypeSchema = z.nativeEnum(ApprovalBizType);

const submitSchema = z.object({
  bizType: bizTypeSchema,
  businessId: z.string().min(1, '业务单据不能为空'),
});

const actionSchema = z.object({
  comment: z.string().optional().nullable(),
});

const listQuerySchema = z.object({
  bizType: bizTypeSchema.optional(),
  status: z.nativeEnum(ApprovalStatus).optional(),
  keyword: z.string().optional(),
  page: z.union([z.string(), z.number()]).optional(),
  pageSize: z.union([z.string(), z.number()]).optional(),
});

/** 事务内业务规则冲突（状态被并发改变）→ 409 */
class ApprovalConflictError extends Error {}

interface BusinessRef {
  id: string;
  no: string | null;
}

type LoadRefResult =
  | { ok: true; ref: BusinessRef }
  | { ok: false; status: 400 | 404; message: string };

/** 按 bizType 读取业务对象（多态旁挂 → application layer 显式分派，不使用 relation） */
async function loadBusinessRef(
  bizType: ApprovalBizType,
  businessId: string,
): Promise<LoadRefResult> {
  const notFound = (label: string): LoadRefResult => ({
    ok: false,
    status: 404,
    message: `${label}不存在`,
  });

  switch (bizType) {
    case ApprovalBizType.QUOTATION: {
      const row = await prisma.quotation.findUnique({
        where: { id: businessId },
        select: { id: true, quotationNo: true },
      });
      return row ? { ok: true, ref: { id: row.id, no: row.quotationNo } } : notFound('报价单');
    }
    case ApprovalBizType.SAMPLE_ORDER: {
      const row = await prisma.sampleOrder.findUnique({
        where: { id: businessId },
        select: { id: true, sampleNo: true },
      });
      return row ? { ok: true, ref: { id: row.id, no: row.sampleNo } } : notFound('打样单');
    }
    case ApprovalBizType.SALES_ORDER: {
      const row = await prisma.salesOrder.findUnique({
        where: { id: businessId },
        select: { id: true, orderNo: true },
      });
      return row ? { ok: true, ref: { id: row.id, no: row.orderNo } } : notFound('销售订单');
    }
    case ApprovalBizType.PRODUCTION_ORDER: {
      const row = await prisma.productionOrder.findUnique({
        where: { id: businessId },
        select: { id: true, productionNo: true },
      });
      return row ? { ok: true, ref: { id: row.id, no: row.productionNo } } : notFound('生产工单');
    }
    case ApprovalBizType.SHIPMENT: {
      const row = await prisma.shipment.findUnique({
        where: { id: businessId },
        select: { id: true, shipmentNo: true },
      });
      return row ? { ok: true, ref: { id: row.id, no: row.shipmentNo } } : notFound('出运单');
    }
    case ApprovalBizType.PURCHASE_ORDER: {
      const row = await prisma.purchaseOrder.findUnique({
        where: { id: businessId },
        select: { id: true, purchaseNo: true },
      });
      return row ? { ok: true, ref: { id: row.id, no: row.purchaseNo } } : notFound('采购单');
    }
    case ApprovalBizType.PAYMENT: {
      const row = await prisma.payment.findUnique({
        where: { id: businessId },
        select: { id: true, paymentNo: true },
      });
      return row ? { ok: true, ref: { id: row.id, no: row.paymentNo } } : notFound('收付款单');
    }
    case ApprovalBizType.PROFIT: {
      const row = await prisma.profit.findUnique({
        where: { id: businessId },
        select: { id: true, profitNo: true },
      });
      return row ? { ok: true, ref: { id: row.id, no: row.profitNo } } : notFound('利润单');
    }
    default:
      return { ok: false, status: 400, message: '不支持的审批业务类型' };
  }
}

/**
 * 在当前用户数据范围内，取某个 bizType 的可见业务对象 id。
 *
 * 注意：ApprovalRecord 无 ownerId / 无 relation，无法通过 relation scope 直接过滤，
 * 因此必须先在业务表上施加 `roleScope`（各 bizType 的 owner 路径见 §20），再回填白名单。
 *
 * @param id 传入时退化为「该对象是否可见」的存在性探测
 */
async function scopedBusinessIds(
  bizType: ApprovalBizType,
  ownerScope: Record<string, unknown>,
  id?: string,
): Promise<string[]> {
  const inner = id ? { id } : {};
  const pick = (rows: { id: string }[]): string[] => rows.map((r) => r.id);

  switch (bizType) {
    case ApprovalBizType.QUOTATION:
      return pick(
        await prisma.quotation.findMany({ where: applyScope(inner, ownerScope), select: { id: true } }),
      );
    case ApprovalBizType.SAMPLE_ORDER:
      return pick(
        await prisma.sampleOrder.findMany({ where: applyScope(inner, ownerScope), select: { id: true } }),
      );
    case ApprovalBizType.SALES_ORDER:
      return pick(
        await prisma.salesOrder.findMany({ where: applyScope(inner, ownerScope), select: { id: true } }),
      );
    case ApprovalBizType.PRODUCTION_ORDER:
      return pick(
        await prisma.productionOrder.findMany({
          where: applyScope(inner, ownerScope),
          select: { id: true },
        }),
      );
    case ApprovalBizType.PURCHASE_ORDER:
      return pick(
        await prisma.purchaseOrder.findMany({
          where: applyScope(inner, ownerScope),
          select: { id: true },
        }),
      );
    // 以下三类自身无 ownerId → 经 relation 继承
    case ApprovalBizType.SHIPMENT:
      return pick(
        await prisma.shipment.findMany({
          where: applyScope(inner, { salesOrder: ownerScope }),
          select: { id: true },
        }),
      );
    case ApprovalBizType.PROFIT:
      return pick(
        await prisma.profit.findMany({
          where: applyScope(inner, { salesOrder: ownerScope }),
          select: { id: true },
        }),
      );
    case ApprovalBizType.PAYMENT:
      return pick(
        await prisma.payment.findMany({
          where: applyScope(inner, {
            OR: [{ salesOrder: ownerScope }, { purchaseOrder: ownerScope }],
          }),
          select: { id: true },
        }),
      );
    default:
      return [];
  }
}

/** 当前用户的 owner scope 条件（ALL / admin → 空对象） */
async function ownerScopeOf(req: AuthRequest): Promise<Record<string, unknown>> {
  return roleScope(req, { field: 'ownerId' });
}

/** 当前用户对某个业务对象是否有 Scope 权限 */
async function hasBusinessAccess(
  req: AuthRequest,
  bizType: ApprovalBizType,
  businessId: string,
): Promise<boolean> {
  const ownerScope = await ownerScopeOf(req);
  if (Object.keys(ownerScope).length === 0) return true; // ALL / admin
  const ids = await scopedBusinessIds(bizType, ownerScope, businessId);
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

/** 该 bizType 的有效审批人集合（无配置 / 停用 / 配置无审批人 → null） */
async function resolveApprovers(
  bizType: ApprovalBizType,
): Promise<{ ok: true; approverIds: string[] } | { ok: false; message: string }> {
  const config = await prisma.approvalConfig.findUnique({ where: { bizType } });
  if (!config || !config.enabled) {
    return { ok: false, message: '该业务类型未配置有效审批流程' };
  }
  const approverIds = parseApproverIds(config.approverIds);
  if (approverIds.length === 0) {
    return { ok: false, message: '该业务类型未配置有效审批流程' };
  }
  return { ok: true, approverIds };
}

/** 写 OperationLog（复用具体业务类型，不新增 APPROVAL 业务类型常量；不写 CustomerActivity） */
function logApproval(
  req: AuthRequest,
  action: string,
  verb: string,
  record: { bizType: ApprovalBizType; businessId: string; businessNo: string | null },
): void {
  const meta = BIZ_META[record.bizType];
  void activityLogger.log({
    userId: req.userId ?? '',
    username: req.username ?? '',
    realName: req.realName,
    action,
    module: meta.module,
    businessType: meta.businessType,
    businessId: record.businessId,
    businessNo: record.businessNo ?? undefined,
    summary: `${req.username ?? ''} ${verb}${meta.label}「${record.businessNo ?? record.businessId}」`,
    ip: req.ip,
  });
}

// ============ 列表（Scope 白名单 OR） ============
export const listApprovalRecords = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query = listQuerySchema.parse(req.query);

    const where: Record<string, unknown> = {};
    if (query.bizType) where.bizType = query.bizType;
    if (query.status) where.status = query.status;
    if (query.keyword) where.businessNo = { contains: query.keyword };

    const ownerScope = await ownerScopeOf(req);
    if (Object.keys(ownerScope).length > 0) {
      // DEPT / SELF：按 bizType 分组求可见业务对象 id 白名单
      const bizTypes = query.bizType ? [query.bizType] : ALL_BIZ_TYPES;
      const orConds: Record<string, unknown>[] = [];
      for (const bizType of bizTypes) {
        const ids = await scopedBusinessIds(bizType, ownerScope);
        if (ids.length > 0) {
          orConds.push({ bizType, businessId: { in: ids } });
        }
      }
      if (orConds.length === 0) {
        success(res, { list: [], total: 0, page: 1, pageSize: Number(query.pageSize) || 20 });
        return;
      }
      where.AND = [{ OR: orConds }];
    }

    const pageNum = Math.max(1, Number(query.page) || 1);
    const pageSizeNum = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    const [list, total] = await Promise.all([
      prisma.approvalRecord.findMany({
        where,
        orderBy: { submittedAt: 'desc' },
        skip: (pageNum - 1) * pageSizeNum,
        take: pageSizeNum,
      }),
      prisma.approvalRecord.count({ where }),
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

// ============ 详情（先查记录 → 再按业务对象 owner 校验 Scope） ============
export const getApprovalRecord = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const record = await prisma.approvalRecord.findUnique({ where: { id: req.params.id } });
    if (!record) {
      fail(res, 404, '审批记录不存在');
      return;
    }
    const allowed = await hasBusinessAccess(req, record.bizType, record.businessId);
    if (!allowed) {
      fail(res, 403, '无权访问该审批记录');
      return;
    }
    success(res, record);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// ============ 提交审批（按业务单据发起，单级、level=1） ============
export const submitApproval = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // 支持两种入口：
    //   POST /api/approval-records/submit        body: { bizType, businessId }
    //   POST /api/approval-records/:id/submit    body: { bizType }，:id 即业务单据 id
    const paramId = req.params.id as string | undefined;
    const body = submitSchema.parse({
      bizType: req.body?.bizType,
      businessId: paramId ?? req.body?.businessId,
    });

    // 1. 业务对象存在性
    const loaded = await loadBusinessRef(body.bizType, body.businessId);
    if (!loaded.ok) {
      fail(res, loaded.status, loaded.message);
      return;
    }

    // 2. 业务 Scope（禁止越权为其他部门/他人的单据发起审批）
    const allowed = await hasBusinessAccess(req, body.bizType, body.businessId);
    if (!allowed) {
      fail(res, 403, '无权对该业务单据发起审批');
      return;
    }

    // 3. 必须有有效审批配置（无配置 / 停用 → 400，不自动放行、不创建记录）
    const approvers = await resolveApprovers(body.bizType);
    if (!approvers.ok) {
      fail(res, 400, approvers.message);
      return;
    }

    // 4. 防重复：同一业务单据不允许同时存在多个 PENDING
    const record = await prisma.$transaction(async (tx) => {
      const pending = await tx.approvalRecord.findFirst({
        where: { bizType: body.bizType, businessId: body.businessId, status: ApprovalStatus.PENDING },
        select: { id: true },
      });
      if (pending) throw new ApprovalConflictError('该业务单据已存在待审批记录');

      return tx.approvalRecord.create({
        data: {
          bizType: body.bizType,
          businessId: body.businessId,
          businessNo: loaded.ref.no,
          level: 1,
          status: ApprovalStatus.PENDING,
          submittedBy: req.userId ?? null,
          approverId: null,
        },
      });
    });

    logApproval(req, 'SUBMIT', '提交了', record);
    created(res, record);
  } catch (e) {
    if (e instanceof z.ZodError) {
      fail(res, 400, e.errors.map((err) => err.message).join(', '));
      return;
    }
    if (e instanceof ApprovalConflictError) {
      fail(res, 409, e.message);
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// ============ 审批通过 ============
export const approveApproval = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = actionSchema.parse(req.body ?? {});
    const record = await prisma.approvalRecord.findUnique({ where: { id: req.params.id } });
    if (!record) {
      fail(res, 404, '审批记录不存在');
      return;
    }
    if (record.status !== ApprovalStatus.PENDING) {
      fail(res, 409, '仅待审批状态可执行审批通过');
      return;
    }

    const approvers = await resolveApprovers(record.bizType);
    if (!approvers.ok) {
      fail(res, 400, approvers.message);
      return;
    }
    if (!req.userId || !approvers.approverIds.includes(req.userId)) {
      fail(res, 403, '您不是该业务类型的审批人');
      return;
    }

    const allowed = await hasBusinessAccess(req, record.bizType, record.businessId);
    if (!allowed) {
      fail(res, 403, '无权操作该业务单据的审批');
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.approvalRecord.findUnique({
        where: { id: record.id },
        select: { status: true },
      });
      if (!current || current.status !== ApprovalStatus.PENDING) {
        throw new ApprovalConflictError('审批记录状态已变更，请刷新后重试');
      }
      return tx.approvalRecord.update({
        where: { id: record.id },
        data: {
          status: ApprovalStatus.APPROVED,
          approverId: req.userId ?? null,
          approvedAt: new Date(),
          ...(body.comment !== undefined ? { comment: body.comment } : {}),
        },
      });
    });

    logApproval(req, 'APPROVE', '审批通过了', updated);
    success(res, updated, '审批通过');
  } catch (e) {
    if (e instanceof z.ZodError) {
      fail(res, 400, e.errors.map((err) => err.message).join(', '));
      return;
    }
    if (e instanceof ApprovalConflictError) {
      fail(res, 409, e.message);
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// ============ 审批驳回（comment 必填） ============
export const rejectApproval = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = actionSchema.parse(req.body ?? {});
    const comment = body.comment?.trim();
    if (!comment) {
      fail(res, 400, '驳回必须填写审批意见');
      return;
    }

    const record = await prisma.approvalRecord.findUnique({ where: { id: req.params.id } });
    if (!record) {
      fail(res, 404, '审批记录不存在');
      return;
    }
    if (record.status !== ApprovalStatus.PENDING) {
      fail(res, 409, '仅待审批状态可执行驳回');
      return;
    }

    const approvers = await resolveApprovers(record.bizType);
    if (!approvers.ok) {
      fail(res, 400, approvers.message);
      return;
    }
    if (!req.userId || !approvers.approverIds.includes(req.userId)) {
      fail(res, 403, '您不是该业务类型的审批人');
      return;
    }

    const allowed = await hasBusinessAccess(req, record.bizType, record.businessId);
    if (!allowed) {
      fail(res, 403, '无权操作该业务单据的审批');
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.approvalRecord.findUnique({
        where: { id: record.id },
        select: { status: true },
      });
      if (!current || current.status !== ApprovalStatus.PENDING) {
        throw new ApprovalConflictError('审批记录状态已变更，请刷新后重试');
      }
      return tx.approvalRecord.update({
        where: { id: record.id },
        data: {
          status: ApprovalStatus.REJECTED,
          approverId: req.userId ?? null,
          // 说明：schema 无 rejectedAt 列，故在 REJECTED 状态下
          // `approvedAt` 表示「审批处理完成时间」，**不是**「批准时间」。
          approvedAt: new Date(),
          comment,
        },
      });
    });

    logApproval(req, 'REJECT', '驳回了', updated);
    success(res, updated, '已驳回');
  } catch (e) {
    if (e instanceof z.ZodError) {
      fail(res, 400, e.errors.map((err) => err.message).join(', '));
      return;
    }
    if (e instanceof ApprovalConflictError) {
      fail(res, 409, e.message);
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// ============ 撤回（仅提交人） ============
export const withdrawApproval = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = actionSchema.parse(req.body ?? {});
    const record = await prisma.approvalRecord.findUnique({ where: { id: req.params.id } });
    if (!record) {
      fail(res, 404, '审批记录不存在');
      return;
    }
    if (record.status !== ApprovalStatus.PENDING) {
      fail(res, 409, '仅待审批状态可撤回');
      return;
    }
    if (!req.userId || record.submittedBy !== req.userId) {
      fail(res, 403, '仅提交人可撤回该审批');
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.approvalRecord.findUnique({
        where: { id: record.id },
        select: { status: true },
      });
      if (!current || current.status !== ApprovalStatus.PENDING) {
        throw new ApprovalConflictError('审批记录状态已变更，请刷新后重试');
      }
      return tx.approvalRecord.update({
        where: { id: record.id },
        data: {
          status: ApprovalStatus.WITHDRAWN,
          // 撤回不产生审批人 / 处理时间，保持 null
          approverId: null,
          approvedAt: null,
          ...(body.comment !== undefined ? { comment: body.comment } : {}),
        },
      });
    });

    logApproval(req, 'WITHDRAW', '撤回了', updated);
    success(res, updated, '已撤回');
  } catch (e) {
    if (e instanceof z.ZodError) {
      fail(res, 400, e.errors.map((err) => err.message).join(', '));
      return;
    }
    if (e instanceof ApprovalConflictError) {
      fail(res, 409, e.message);
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// 说明：本 runtime **不修改任何业务单据的业务 status**；
// 业务状态联动（APPROVED → SalesOrder.status 等）为 Deferred，需独立业务规则 slice。
