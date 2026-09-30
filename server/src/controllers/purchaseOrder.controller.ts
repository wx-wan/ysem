import { Response } from 'express';
import { z } from 'zod';
import { DomainError } from '../lib/errors';
import { AuthRequest } from '../middleware/auth';
import type { SalesActorContext } from '../services/salesProcess.shared';
import * as purchaseOrderService from '../services/purchaseOrder.service';
import { created, fail, success } from '../utils/response';
import { productVisibilityWhere, roleScope } from '../scope';

/**
 * PurchaseOrder Controller —— Round R-5 · Phase 4 · D1-a 采购域
 *
 * 职责（仅此）：HTTP request/response、参数解析、DTO 校验、上下文注入、错误映射。
 * **禁止** Prisma 访问 / 事务 / 业务规则 —— 已在 `services/purchaseOrder.service.ts`（Business）
 * / `operations/procurement.operations.ts`（Operation：取号 + 明细重建 + ProductionOrderItem 行锁）
 * / `repositories/*`（Data）。API Contract 保持不变。
 */

function buildActorContext(req: AuthRequest): SalesActorContext {
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
export const listPurchaseOrders = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query = purchaseOrderService.purchaseOrderListQuerySchema.parse(req.query);
    success(res, await purchaseOrderService.list(query, buildActorContext(req)));
  } catch (err) {
    respondError(res, err);
  }
};

// ============ 详情 ============
export const getPurchaseOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    success(res, await purchaseOrderService.getOne(req.params.id, buildActorContext(req)));
  } catch (err) {
    respondError(res, err);
  }
};

// ============ 新建（事务：单据 + 明细 + 汇总，原子） ============
export const createPurchaseOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = purchaseOrderService.purchaseOrderCreateSchema.parse(req.body);
    created(res, await purchaseOrderService.create(body, buildActorContext(req)));
  } catch (err) {
    respondError(res, err);
  }
};

// ============ 更新（事务：单据 + 明细重建 + 汇总重算，原子） ============
export const updatePurchaseOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id, ...rest } = purchaseOrderService.purchaseOrderUpdateSchema.parse({
      id: req.params.id,
      ...req.body,
    });
    success(res, await purchaseOrderService.update(id, rest, buildActorContext(req)), '更新成功');
  } catch (err) {
    respondError(res, err);
  }
};

// ============ 删除 ============
export const removePurchaseOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await purchaseOrderService.remove(req.params.id, buildActorContext(req));
    success(res, null, '删除成功');
  } catch (err) {
    respondError(res, err);
  }
};
