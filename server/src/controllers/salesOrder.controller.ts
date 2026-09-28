import { Response } from 'express';
import { z } from 'zod';
import { DomainError } from '../lib/errors';
import { AuthRequest } from '../middleware/auth';
import * as salesOrderService from '../services/salesOrder.service';
import type { SalesActorContext } from '../services/salesProcess.shared';
import { created, fail, success } from '../utils/response';
import { productVisibilityWhere, roleScope } from '../utils/scope';

/**
 * SalesOrder Controller —— Round R-5 · Phase 1 · Sales Process Domain
 *
 * 职责（仅此）：HTTP request/response、参数解析、DTO 校验、上下文注入、响应格式化。
 *
 * **禁止**：Prisma 访问、事务编排、业务规则、状态机、Customer 统计回算
 * —— 均已迁往 `services/salesOrder.service.ts`（Business）
 *    / `operations/sales.operations.ts`（Operation，唯一事务归属 + B5 统计回算入口）
 *    / `repositories/salesOrder.repository.ts`（Data）。
 *
 * API Contract 保持不变。SalesOrder 是同一 Sales Process 的**成交事实**，
 * **不**新增、**不**写 `channelId` / `shopId`（渠道经 `opportunityId` 追溯起点）。
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

function respondError(res: Response, err: unknown, zodAware: boolean): void {
  if (err instanceof DomainError) {
    fail(res, err.code, err.message);
    return;
  }
  if (zodAware && err instanceof z.ZodError) {
    fail(res, 400, err.errors.map((e) => e.message).join(', '));
    return;
  }
  fail(res, 500, '服务器错误');
}

// ============ 列表 ============

export const listSalesOrders = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query = salesOrderService.salesOrderListQuerySchema.parse(req.query);
    success(res, await salesOrderService.listSalesOrders(query, buildActorContext(req)));
  } catch (err) {
    respondError(res, err, true);
  }
};

// ============ 详情 ============

export const getSalesOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    success(res, await salesOrderService.getSalesOrder(req.params.id, buildActorContext(req)));
  } catch (err) {
    respondError(res, err, false);
  }
};

// ============ 新建 ============

export const createSalesOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = salesOrderService.salesOrderCreateSchema.parse(req.body);
    const item = await salesOrderService.createSalesOrder(body, buildActorContext(req));
    created(res, item);
  } catch (err) {
    respondError(res, err, true);
  }
};

// ============ 更新（局部更新；明细整表重建） ============

export const updateSalesOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id, ...rest } = salesOrderService.salesOrderUpdateSchema.parse({
      id: req.params.id,
      ...req.body,
    });
    const item = await salesOrderService.updateSalesOrder(id, rest, buildActorContext(req));
    success(res, item, '更新成功');
  } catch (err) {
    respondError(res, err, true);
  }
};

// ============ 删除 ============

export const removeSalesOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await salesOrderService.removeSalesOrder(req.params.id, buildActorContext(req));
    success(res, null, '删除成功');
  } catch (err) {
    respondError(res, err, false);
  }
};
