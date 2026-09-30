import { Response } from 'express';
import { z } from 'zod';
import { DomainError } from '../lib/errors';
import { AuthRequest } from '../middleware/auth';
import type { SalesActorContext } from '../services/salesProcess.shared';
import * as qualityInspectionService from '../services/qualityInspection.service';
import { created, fail, success } from '../utils/response';
import { productVisibilityWhere, roleScope } from '../scope';

/**
 * QualityInspection Controller —— Round R-5 · Phase 4 · D1-b 生产质量域
 *
 * 职责（仅此）：HTTP request/response、参数解析、DTO 校验、上下文注入、错误映射。
 * **禁止** Prisma 访问 / 事务 / 业务规则 —— 已在
 *   `services/qualityInspection.service.ts`（Business：exactly-one owner / 宿主存在性 /
 *    双宿主 OR scope / 结论 append-only）
 *   `operations/production.operations.ts`（Operation：取号）
 *   `repositories/qualityInspection.repository.ts`（Data）。API Contract 保持不变。
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
export const listQualityInspections = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query = qualityInspectionService.qualityInspectionListQuerySchema.parse(req.query);
    success(res, await qualityInspectionService.list(query, buildActorContext(req)));
  } catch (err) {
    respondError(res, err);
  }
};

// ============ 详情 ============
export const getQualityInspection = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    success(res, await qualityInspectionService.getOne(req.params.id, buildActorContext(req)));
  } catch (err) {
    respondError(res, err);
  }
};

// ============ 新建 ============
export const createQualityInspection = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = qualityInspectionService.qualityInspectionCreateSchema.parse(req.body);
    created(res, await qualityInspectionService.create(body, buildActorContext(req)));
  } catch (err) {
    respondError(res, err);
  }
};

// ============ 更新 ============
export const updateQualityInspection = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id, ...rest } = qualityInspectionService.qualityInspectionUpdateSchema.parse({
      id: req.params.id,
      ...req.body,
    });
    success(res, await qualityInspectionService.update(id, rest, buildActorContext(req)), '更新成功');
  } catch (err) {
    respondError(res, err);
  }
};

// ============ 删除（业务上禁止，可见即 409） ============
export const removeQualityInspection = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await qualityInspectionService.remove(req.params.id, buildActorContext(req));
    success(res, null, '删除成功');
  } catch (err) {
    respondError(res, err);
  }
};
