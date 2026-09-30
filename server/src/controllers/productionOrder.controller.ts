import { Response } from 'express';
import { z } from 'zod';
import { DomainError } from '../lib/errors';
import { AuthRequest } from '../middleware/auth';
import type { SalesActorContext } from '../services/salesProcess.shared';
import * as productionOrderService from '../services/productionOrder.service';
import { created, fail, success } from '../utils/response';
import { productVisibilityWhere, roleScope } from '../scope';

/**
 * ProductionOrder Controller —— Round R-5 · Phase 4 · D1-b 生产质量域
 *
 * 职责（仅此）：HTTP request/response、参数解析、DTO 校验、上下文注入、错误映射。
 * **禁止** Prisma 访问 / 事务 / 业务规则 —— 已在
 *   `services/productionOrder.service.ts`（Business：明细快照 / 数量校验 / 进度派生）
 *   `state/productionOrderState.state.ts`（State：ProductionStatus 状态机，**纯规则**）
 *   `operations/production.operations.ts`（Operation：取号 + 明细重建引用保护临界区）
 *   `repositories/*`（Data）。API Contract 保持不变。
 *
 * 【归位说明】原控制器内联的 `ALLOWED_PRODUCTION_TRANSITIONS` / `checkProductionStatusTransition`
 * 已移至 State 能力（行为逐字不变）。
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
export const listProductionOrders = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query = productionOrderService.productionOrderListQuerySchema.parse(req.query);
    success(res, await productionOrderService.list(query, buildActorContext(req)));
  } catch (err) {
    respondError(res, err);
  }
};

// ============ 详情 ============
export const getProductionOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    success(res, await productionOrderService.getOne(req.params.id, buildActorContext(req)));
  } catch (err) {
    respondError(res, err);
  }
};

// ============ 新建 ============
export const createProductionOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = productionOrderService.productionOrderCreateSchema.parse(req.body);
    created(res, await productionOrderService.create(body, buildActorContext(req)));
  } catch (err) {
    respondError(res, err);
  }
};

// ============ 更新（局部更新；明细整表重建需先确认未被采购单引用） ============
export const updateProductionOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id, ...rest } = productionOrderService.productionOrderUpdateSchema.parse({
      id: req.params.id,
      ...req.body,
    });
    success(res, await productionOrderService.update(id, rest, buildActorContext(req)), '更新成功');
  } catch (err) {
    respondError(res, err);
  }
};

// ============ 删除 ============
export const removeProductionOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await productionOrderService.remove(req.params.id, buildActorContext(req));
    success(res, null, '删除成功');
  } catch (err) {
    respondError(res, err);
  }
};
