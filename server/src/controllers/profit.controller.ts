import { Response } from 'express';
import { z } from 'zod';
import { DomainError } from '../lib/errors';
import { AuthRequest } from '../middleware/auth';
import type { FinanceActorContext } from '../services/finance.shared';
import * as profitService from '../services/profit.service';
import { created, fail, success } from '../utils/response';
import { productVisibilityWhere, roleScope } from '../scope';

/**
 * Profit Controller —— Round R-5 · Phase 4 · D2 财务域
 *
 * 职责（仅此）：HTTP request/response、参数解析、DTO 校验、上下文注入、错误映射。
 * **禁止** Prisma 访问 / 事务 / 业务规则 —— 已在 `services/profit.service.ts`（Business，
 * 含收入 / 成本 / 利润 / 利润率 / costSnapshot 口径）
 * / `operations/finance.operations.ts`（Operation：取号 + Shipment 运费归集事务）
 * / `repositories/*`（Data）。API Contract 保持不变。
 *
 * 注：本域**不提供** DELETE（Profit 为 SalesOrder 1:1 审计实体，纠错走 DRAFT / 重算 / 更新）。
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
export const listProfits = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query = profitService.profitListQuerySchema.parse(req.query);
    success(res, await profitService.list(query, buildActorContext(req)));
  } catch (err) {
    respondError(res, err);
  }
};

// ============ 详情 ============
export const getProfit = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    success(res, await profitService.getOne(req.params.id, buildActorContext(req)));
  } catch (err) {
    respondError(res, err);
  }
};

// ============ 新建（同一 SalesOrder 仅允许一条 → 409） ============
export const createProfit = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = profitService.profitCreateSchema.parse(req.body);
    created(res, await profitService.create(body, buildActorContext(req)));
  } catch (err) {
    respondError(res, err);
  }
};

// ============ 更新（全量重算：成本 / 总额 / 利润 / 利润率 / 快照） ============
export const updateProfit = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id, ...rest } = profitService.profitUpdateSchema.parse({
      id: req.params.id,
      ...req.body,
    });
    success(res, await profitService.update(id, rest, buildActorContext(req)), '更新成功');
  } catch (err) {
    respondError(res, err);
  }
};
