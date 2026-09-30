import { Response } from 'express';
import { z } from 'zod';
import { DomainError } from '../lib/errors';
import { AuthRequest } from '../middleware/auth';
import * as approvalRecordService from '../services/approvalRecord.service';
import type { ApprovalActorContext } from '../services/approvalRecord.service';
import { created, fail, success } from '../utils/response';
import { roleScope } from '../scope';

/**
 * ApprovalRecord Controller —— Round R-5 · Phase 4 · D3 审批域
 *
 * 职责（仅此）：HTTP request/response、参数解析、DTO 校验、上下文注入、错误映射。
 * **禁止** Prisma 访问 / 事务 / 业务规则 —— 已在 `services/approvalRecord.service.ts`（Business）
 * / `operations/approval.operations.ts`（Operation：多态引用分派 + 流转事务）
 * / `repositories/*`（Data）。API Contract 保持不变。
 *
 * 说明：本 runtime **不修改任何业务单据的业务 status**；业务状态联动为 Deferred。
 */

function buildActorContext(req: AuthRequest): ApprovalActorContext {
  return {
    userId: req.userId,
    username: req.username,
    realName: req.realName,
    ip: req.ip,
    scope: { owner: () => roleScope(req, { field: 'ownerId' }) },
  };
}

function respondError(res: Response, err: unknown): void {
  if (err instanceof DomainError) {
    fail(res, err.code, err.message);
    return;
  }
  if (err instanceof z.ZodError) {
    fail(res, 400, err.errors.map((e) => e.message).join(', '));
    return;
  }
  fail(res, 500, '服务器错误');
}

// ============ 列表（Scope 白名单 OR） ============
export const listApprovalRecords = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query = approvalRecordService.approvalListQuerySchema.parse(req.query);
    success(res, await approvalRecordService.list(query, buildActorContext(req)));
  } catch (err) {
    respondError(res, err);
  }
};

// ============ 详情 ============
export const getApprovalRecord = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    success(res, await approvalRecordService.getOne(req.params.id, buildActorContext(req)));
  } catch (err) {
    respondError(res, err);
  }
};

// ============ 提交审批（支持 /submit 与 /:id/submit 两种入口） ============
export const submitApproval = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const paramId = req.params.id as string | undefined;
    const body = approvalRecordService.approvalSubmitSchema.parse({
      bizType: req.body?.bizType,
      businessId: paramId ?? req.body?.businessId,
    });
    const record = await approvalRecordService.submit(body, buildActorContext(req));
    created(res, record);
  } catch (err) {
    respondError(res, err);
  }
};

// ============ 审批通过 ============
export const approveApproval = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = approvalRecordService.approvalActionSchema.parse(req.body ?? {});
    const record = await approvalRecordService.approve(req.params.id, body.comment, buildActorContext(req));
    success(res, record, '审批通过');
  } catch (err) {
    respondError(res, err);
  }
};

// ============ 审批驳回（comment 必填） ============
export const rejectApproval = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = approvalRecordService.approvalActionSchema.parse(req.body ?? {});
    const record = await approvalRecordService.reject(req.params.id, body.comment, buildActorContext(req));
    success(res, record, '已驳回');
  } catch (err) {
    respondError(res, err);
  }
};

// ============ 撤回（仅提交人） ============
export const withdrawApproval = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = approvalRecordService.approvalActionSchema.parse(req.body ?? {});
    const record = await approvalRecordService.withdraw(req.params.id, body.comment, buildActorContext(req));
    success(res, record, '已撤回');
  } catch (err) {
    respondError(res, err);
  }
};
