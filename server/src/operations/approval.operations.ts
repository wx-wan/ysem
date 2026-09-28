import { ApprovalBizType, ApprovalStatus } from '@prisma/client';
import { DomainConflictError } from '../lib/errors';
import {
  approvalRecordRepository,
  paymentRepository,
  productionOrderRepository,
  profitRepository,
  purchaseOrderRepository,
  quotationRepository,
  runInTransaction,
  salesOrderRepository,
  sampleOrderRepository,
  shipmentRepository,
} from '../repositories';

/**
 * Approval Operation Layer —— Round R-5 · Phase 4 · D3 审批域
 *
 * 职责：多态业务引用的**跨域取数分派**、审批流转的**事务编排**、
 * 「仅待审批可流转」的并发安全断言。
 *
 * 不负责业务政策判断（谁能提交 / 谁能审批 / 配置是否有效）—— 那些在
 * `services/approvalRecord.service.ts`（Business）。
 *
 * 【事务归属（Master Plan §12）】本文件是审批域 `$transaction` 的唯一归属地。
 */

export interface BusinessRef {
  id: string;
  no: string | null;
}

/** 冻结的 8 个业务类型（显式列举，确保不引入 enum 中不存在的 QUALITY_INSPECTION） */
export const ALL_APPROVAL_BIZ_TYPES: ApprovalBizType[] = [
  ApprovalBizType.QUOTATION,
  ApprovalBizType.SAMPLE_ORDER,
  ApprovalBizType.SALES_ORDER,
  ApprovalBizType.PRODUCTION_ORDER,
  ApprovalBizType.SHIPMENT,
  ApprovalBizType.PURCHASE_ORDER,
  ApprovalBizType.PAYMENT,
  ApprovalBizType.PROFIT,
];

/**
 * 按 bizType 读取业务对象引用（主键 + 编号）。
 *
 * 多态旁挂 ⇒ application layer **显式分派**到各业务域仓储，不使用 Prisma relation。
 * 返回 null 表示对象不存在（「不存在」与「越权」的响应区分由 Business 层决定）。
 */
export async function loadBusinessRefOperation(
  bizType: ApprovalBizType,
  businessId: string,
): Promise<BusinessRef | null> {
  switch (bizType) {
    case ApprovalBizType.QUOTATION: {
      const row = await quotationRepository.findRefById(businessId);
      return row ? { id: row.id, no: row.quotationNo } : null;
    }
    case ApprovalBizType.SAMPLE_ORDER: {
      const row = await sampleOrderRepository.findRefById(businessId);
      return row ? { id: row.id, no: row.sampleNo } : null;
    }
    case ApprovalBizType.SALES_ORDER: {
      const row = await salesOrderRepository.findRefById(businessId);
      return row ? { id: row.id, no: row.orderNo } : null;
    }
    case ApprovalBizType.PRODUCTION_ORDER: {
      const row = await productionOrderRepository.findRefById(businessId);
      return row ? { id: row.id, no: row.productionNo } : null;
    }
    case ApprovalBizType.SHIPMENT: {
      const row = await shipmentRepository.findRefById(businessId);
      return row ? { id: row.id, no: row.shipmentNo } : null;
    }
    case ApprovalBizType.PURCHASE_ORDER: {
      const row = await purchaseOrderRepository.findRefById(businessId);
      return row ? { id: row.id, no: row.purchaseNo } : null;
    }
    case ApprovalBizType.PAYMENT: {
      const row = await paymentRepository.findRefById(businessId);
      return row ? { id: row.id, no: row.paymentNo } : null;
    }
    case ApprovalBizType.PROFIT: {
      const row = await profitRepository.findRefById(businessId);
      return row ? { id: row.id, no: row.profitNo } : null;
    }
    default:
      return null;
  }
}

/**
 * 在当前用户数据范围内，取某个 bizType 的可见业务对象 id 白名单。
 *
 * ApprovalRecord 无 ownerId / 无 relation，无法经 relation scope 过滤 ⇒
 * 必须先在**业务表本身**施加 `roleScope`，再回填白名单。
 *
 * 各 bizType 的 owner 路径（与既有实现逐字一致）：
 *   QUOTATION / SAMPLE_ORDER / SALES_ORDER / PRODUCTION_ORDER / PURCHASE_ORDER → 自身 ownerId
 *   SHIPMENT → 经 salesOrder 继承
 *   PROFIT   → 经 salesOrder 继承
 *   PAYMENT  → 经 salesOrder 或 purchaseOrder 继承
 *
 * @param id 传入时退化为「该对象是否可见」的存在性探测
 */
export async function scopedBusinessIdsOperation(
  bizType: ApprovalBizType,
  ownerScope: Record<string, unknown>,
  id?: string,
): Promise<string[]> {
  const pick = (rows: { id: string }[]) => rows.map((r) => r.id);

  switch (bizType) {
    case ApprovalBizType.QUOTATION:
      return pick(await quotationRepository.findScopedIds(ownerScope, id));
    case ApprovalBizType.SAMPLE_ORDER:
      return pick(await sampleOrderRepository.findScopedIds(ownerScope, id));
    case ApprovalBizType.SALES_ORDER:
      return pick(await salesOrderRepository.findScopedIds(ownerScope, id));
    case ApprovalBizType.PRODUCTION_ORDER:
      return pick(await productionOrderRepository.findScopedIds(ownerScope, id));
    case ApprovalBizType.PURCHASE_ORDER:
      return pick(await purchaseOrderRepository.findScopedIds(ownerScope, id));
    case ApprovalBizType.SHIPMENT:
      return pick(await shipmentRepository.findScopedIds({ salesOrder: ownerScope }, id));
    case ApprovalBizType.PROFIT:
      return pick(await profitRepository.findScopedIds({ salesOrder: ownerScope }, id));
    case ApprovalBizType.PAYMENT:
      return pick(
        await paymentRepository.findScopedIds(
          { OR: [{ salesOrder: ownerScope }, { purchaseOrder: ownerScope }] },
          id,
        ),
      );
    default:
      return [];
  }
}

// ============================================================
// 流转事务
// ============================================================

/** 提交审批：防重复（PENDING 唯一）+ 建记录，同事务 */
export function submitApprovalOperation(input: {
  bizType: ApprovalBizType;
  businessId: string;
  businessNo: string | null;
  submittedBy: string | null;
}) {
  return runInTransaction(async (tx) => {
    const pending = await approvalRecordRepository.findPending(
      input.bizType,
      input.businessId,
      tx,
    );
    if (pending) throw new DomainConflictError('该业务单据已存在待审批记录');

    return approvalRecordRepository.create(
      {
        bizType: input.bizType,
        businessId: input.businessId,
        businessNo: input.businessNo,
        level: 1,
        status: ApprovalStatus.PENDING,
        submittedBy: input.submittedBy,
        approverId: null,
      },
      tx,
    );
  });
}

/**
 * 审批通过 / 驳回的共同骨架：事务内复检「仅待审批可流转」，
 * 状态已变更 ⇒ 409（并发安全）；避免 TOCTOU。
 */
function transitionOperation(
  id: string,
  mutate: (ctx: { approverId: string | null; comment?: string | null }) => Record<string, unknown>,
  ctx: { approverId: string | null; comment?: string | null },
) {
  return runInTransaction(async (tx) => {
    const current = await approvalRecordRepository.findStatusById(id, tx);
    if (!current || current.status !== ApprovalStatus.PENDING) {
      throw new DomainConflictError('审批记录状态已变更，请刷新后重试');
    }
    return approvalRecordRepository.updateStatus(id, mutate(ctx), tx);
  });
}

/** 审批通过 */
export function approveApprovalOperation(id: string, approverId: string, comment?: string | null) {
  return transitionOperation(
    id,
    (c) => ({
      status: ApprovalStatus.APPROVED,
      approverId: c.approverId,
      approvedAt: new Date(),
      ...(c.comment !== undefined ? { comment: c.comment } : {}),
    }),
    { approverId, comment },
  );
}

/** 审批驳回（comment 必填，由 Business 层保证非空） */
export function rejectApprovalOperation(id: string, approverId: string, comment: string) {
  return transitionOperation(
    id,
    (c) => ({
      status: ApprovalStatus.REJECTED,
      approverId: c.approverId,
      // schema 无 rejectedAt 列，故 REJECTED 下 approvedAt 表示「审批处理完成时间」
      approvedAt: new Date(),
      comment: c.comment,
    }),
    { approverId, comment },
  );
}

/** 撤回（仅提交人；撤回不产生审批人 / 处理时间，保持 null） */
export function withdrawApprovalOperation(id: string, comment?: string | null) {
  return transitionOperation(
    id,
    (c) => ({
      status: ApprovalStatus.WITHDRAWN,
      approverId: null,
      approvedAt: null,
      ...(c.comment !== undefined ? { comment: c.comment } : {}),
    }),
    { approverId: null, comment },
  );
}
