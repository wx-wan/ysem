import { Response } from 'express';
import { z } from 'zod';
import { DomainError } from '../lib/errors';
import { AuthRequest } from '../middleware/auth';
import type { FinanceActorContext } from '../services/finance.shared';
import * as paymentService from '../services/payment.service';
import { created, fail, success } from '../utils/response';
import { productVisibilityWhere, roleScope } from '../scope';

/**
 * Payment Controller —— Round R-5 · Phase 4 · D2 财务域
 *
 * 职责（仅此）：HTTP request/response、参数解析、DTO 校验、上下文注入、错误映射。
 * **禁止** Prisma 访问 / 事务 / 业务规则 —— 已在 `services/payment.service.ts`（Business）
 * / `operations/finance.operations.ts`（Operation：宿主行锁 + paidAmountCny 重算事务）
 * / `repositories/*`（Data）。API Contract 保持不变。
 */

function buildActorContext(req: AuthRequest): FinanceActorContext {
  return {
    userId: req.userId,
    username: req.username,
    realName: req.realName,
    roleCode: req.roleCode,
    ip: req.ip,
    scope: {
      owner: () => roleScope(req, { field: 'ownerId' }),
      assignee: () => roleScope(req, { field: 'id' }),
      productVisibility: () => productVisibilityWhere(req),
      salesOrderOwner: () => roleScope(req, { field: 'ownerId', relation: 'salesOrder' }),
      purchaseOrderOwner: () => roleScope(req, { field: 'ownerId', relation: 'purchaseOrder' }),
    },
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

// ============ 列表 ============
export const listPayments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query = paymentService.paymentListQuerySchema.parse(req.query);
    success(res, await paymentService.list(query, buildActorContext(req)));
  } catch (err) {
    respondError(res, err);
  }
};

// ============ 详情 ============
export const getPayment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    success(res, await paymentService.getOne(req.params.id, buildActorContext(req)));
  } catch (err) {
    respondError(res, err);
  }
};

// ============ 新建（事务：写单 + 重算 paidAmountCny） ============
export const createPayment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = paymentService.paymentCreateSchema.parse(req.body);
    created(res, await paymentService.create(body, buildActorContext(req)));
  } catch (err) {
    respondError(res, err);
  }
};

// ============ 更新（事务：写单 + 对旧/新 SalesOrder 去重重算） ============
export const updatePayment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id, ...rest } = paymentService.paymentUpdateSchema.parse({
      id: req.params.id,
      ...req.body,
    });
    success(res, await paymentService.update(id, rest, buildActorContext(req)), '更新成功');
  } catch (err) {
    respondError(res, err);
  }
};

// ============ 删除（事务：删单 + 重算 paidAmountCny） ============
export const removePayment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await paymentService.remove(req.params.id, buildActorContext(req));
    success(res, null, '删除成功');
  } catch (err) {
    respondError(res, err);
  }
};
