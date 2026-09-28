import { Response } from 'express';
import { z } from 'zod';
import { DomainError } from '../lib/errors';
import { AuthRequest } from '../middleware/auth';
import * as sampleOrderService from '../services/sampleOrder.service';
import type { SalesActorContext } from '../services/salesProcess.shared';
import { created, fail, success } from '../utils/response';
import { productVisibilityWhere, projectProductRow, roleScope } from '../utils/scope';

/**
 * SampleOrder Controller —— Round R-5 · Phase 1 · Sales Process Domain
 *
 * 职责（仅此）：HTTP request/response、参数解析、DTO 校验、上下文注入、响应格式化。
 *
 * **禁止**：Prisma 访问、事务编排、业务规则、轮次生命周期
 * —— 均已迁往 `services/sampleOrder.service.ts`（Business）
 *    / `operations/sales.operations.ts`（Operation，唯一事务归属）
 *    / `repositories/sampleOrder.repository.ts`（Data）。
 *
 * API Contract 保持不变。SampleOrder 属同一 Sales Process 内的记录，
 * **不**新增、**不**写 `channelId` / `shopId`。
 */

/** 打样单关联产品的公开字段（DQ-3=C 投影白名单） */
const SAMPLE_ORDER_PRODUCT_FIELDS = ['id', 'name', 'sku'] as const;

const withProductVisibility = <T>(req: AuthRequest, record: T): T =>
  projectProductRow(req, record, SAMPLE_ORDER_PRODUCT_FIELDS, { nameField: 'productName' });

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

export const listSampleOrders = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query = sampleOrderService.sampleOrderListQuerySchema.parse(req.query);
    const result = await sampleOrderService.listSampleOrders(query, buildActorContext(req));
    success(res, {
      list: result.list.map((row) => withProductVisibility(req, row)),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    });
  } catch (err) {
    respondError(res, err, true);
  }
};

// ============ 详情 ============

export const getSampleOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const item = await sampleOrderService.getSampleOrder(req.params.id, buildActorContext(req));
    success(res, withProductVisibility(req, item));
  } catch (err) {
    respondError(res, err, false);
  }
};

// ============ 新建（可同时带初始轮次） ============

export const createSampleOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = sampleOrderService.sampleOrderCreateSchema.parse(req.body);
    const item = await sampleOrderService.createSampleOrder(body, buildActorContext(req));
    created(res, withProductVisibility(req, item));
  } catch (err) {
    respondError(res, err, true);
  }
};

// ============ 更新（局部更新，不触历史轮次） ============

export const updateSampleOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id, ...rest } = sampleOrderService.sampleOrderUpdateSchema.parse({
      id: req.params.id,
      ...req.body,
    });
    const item = await sampleOrderService.updateSampleOrder(id, rest, buildActorContext(req));
    success(res, withProductVisibility(req, item), '更新成功');
  } catch (err) {
    respondError(res, err, true);
  }
};

// ============ 删除 ============

export const removeSampleOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await sampleOrderService.removeSampleOrder(req.params.id, buildActorContext(req));
    success(res, null, '删除成功');
  } catch (err) {
    respondError(res, err, false);
  }
};

// ============ 轮次 ============

export const listSampleRounds = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    success(res, await sampleOrderService.listSampleRounds(req.params.id, buildActorContext(req)));
  } catch (err) {
    respondError(res, err, false);
  }
};

export const createSampleRound = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const input = sampleOrderService.sampleRoundSchema.parse(req.body);
    const round = await sampleOrderService.createSampleRound(
      req.params.id,
      input,
      buildActorContext(req),
    );
    created(res, round);
  } catch (err) {
    respondError(res, err, true);
  }
};

export const updateSampleRound = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const input = sampleOrderService.sampleRoundSchema.parse(req.body);
    const round = await sampleOrderService.updateSampleRound(
      req.params.id,
      req.params.roundId,
      input,
      buildActorContext(req),
    );
    success(res, round, '更新成功');
  } catch (err) {
    respondError(res, err, true);
  }
};

export const removeSampleRound = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await sampleOrderService.removeSampleRound(
      req.params.id,
      req.params.roundId,
      buildActorContext(req),
    );
    success(res, null, '删除成功');
  } catch (err) {
    respondError(res, err, false);
  }
};
