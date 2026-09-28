import { QuotationStatus } from '@prisma/client';
import { Response } from 'express';
import { z } from 'zod';
import { DomainError } from '../lib/errors';
import { AuthRequest } from '../middleware/auth';
import * as quotationService from '../services/quotation.service';
import type { SalesActorContext } from '../services/salesProcess.shared';
import { created, fail, success } from '../utils/response';
import { productVisibilityWhere, projectProductRows, roleScope } from '../utils/scope';

/**
 * Quotation Controller —— Round R-5 · Phase 1 · Sales Process Domain
 *
 * 职责（仅此）：HTTP request/response、参数解析、DTO 校验、上下文注入、响应格式化。
 *
 * **禁止**：Prisma 访问、事务编排、业务规则、状态机
 * —— 均已迁往 `services/quotation.service.ts`（Business）
 *    / `operations/sales.operations.ts`（Operation，唯一事务归属）
 *    / `repositories/quotation.repository.ts`（Data）。
 *
 * API Contract 保持不变。Quotation 属同一 Sales Process 内的记录，
 * **不**新增、**不**写 `channelId` / `shopId`（渠道经 `opportunityId` 追溯起点）。
 */

/** 明细关联产品的公开字段（DQ-3=C 投影白名单） */
const QUOTATION_ITEM_PRODUCT_FIELDS = ['id', 'name', 'sku'] as const;

const withProductVisibility = <T>(req: AuthRequest, record: T): T => {
  const rec = record as Record<string, unknown>;
  return {
    ...rec,
    items: projectProductRows(
      req,
      (rec.items ?? []) as Record<string, unknown>[],
      QUOTATION_ITEM_PRODUCT_FIELDS,
      { nameField: 'productName' },
    ),
  } as T;
};

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

export const listQuotations = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const q = req.query as Record<string, string>;
    const result = await quotationService.listQuotations(
      {
        opportunityId: q.opportunityId,
        customerId: q.customerId,
        status: q.status as QuotationStatus | undefined,
        productId: q.productId,
        // 既有契约：page 默认 1、pageSize 默认 50（与迁移前 controller 的 query 默认值一致）
        page: q.page ?? 1,
        pageSize: q.pageSize ?? 50,
      },
      buildActorContext(req),
    );
    success(res, {
      list: result.list.map((row) => withProductVisibility(req, row)),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    });
  } catch (err) {
    respondError(res, err, false);
  }
};

// ============ 详情 ============

export const getQuotation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const item = await quotationService.getQuotation(req.params.id, buildActorContext(req));
    success(res, withProductVisibility(req, item));
  } catch (err) {
    respondError(res, err, false);
  }
};

// ============ 新建 ============

export const createQuotation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = quotationService.quotationCreateSchema.parse(req.body);
    const item = await quotationService.createQuotation(body, buildActorContext(req));
    created(res, withProductVisibility(req, item));
  } catch (err) {
    respondError(res, err, true);
  }
};

// ============ 更新 ============

export const updateQuotation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id, ...rest } = quotationService.quotationUpdateSchema.parse({
      id: req.params.id,
      ...req.body,
    });
    const item = await quotationService.updateQuotation(id, rest, buildActorContext(req));
    success(res, withProductVisibility(req, item), '更新成功');
  } catch (err) {
    respondError(res, err, true);
  }
};

// ============ 删除 ============

export const removeQuotation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await quotationService.removeQuotation(req.params.id, buildActorContext(req));
    success(res, null, '删除成功');
  } catch (err) {
    respondError(res, err, false);
  }
};
