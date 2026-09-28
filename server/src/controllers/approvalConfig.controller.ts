import { Response } from 'express';
import { z } from 'zod';
import { DomainError } from '../lib/errors';
import { AuthRequest } from '../middleware/auth';
import * as approvalConfigService from '../services/approvalConfig.service';
import { created, fail, success } from '../utils/response';

/**
 * ApprovalConfig Controller —— Round R-5 · Phase 4 · D3 审批域
 *
 * 职责（仅此）：HTTP request/response、参数解析、DTO 校验、响应格式化。
 * **禁止** Prisma 访问 / 事务 / 业务规则 —— 已在 `services/approvalConfig.service.ts`（Business）
 * / `repositories/approvalConfig.repository.ts`（Data）。API Contract 保持不变。
 */

function respondError(res: Response, err: unknown, zodMessage?: string): void {
  if (err instanceof DomainError) {
    fail(res, err.code, err.message);
    return;
  }
  if (err instanceof z.ZodError) {
    fail(res, 400, zodMessage ?? err.errors.map((e) => e.message).join(', '));
    return;
  }
  fail(res, 500, '服务器错误');
}

/** 路径参数 bizType 解析（既有实现对此路径的 400 文案为固定值） */
function parseBizTypeParam(raw: string): string | null {
  const parsed = approvalConfigService.approvalBizTypeSchema.safeParse(raw);
  return parsed.success ? raw : null;
}

// ============ 列表 ============
export const listApprovalConfigs = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    success(res, await approvalConfigService.list());
  } catch (err) {
    respondError(res, err);
  }
};

// ============ 详情（按 bizType） ============
export const getApprovalConfig = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const bizType = parseBizTypeParam(req.params.bizType);
    if (!bizType) {
      fail(res, 400, '不支持的审批业务类型');
      return;
    }
    success(res, await approvalConfigService.getByBizType(bizType as never));
  } catch (err) {
    respondError(res, err);
  }
};

// ============ 新建（每个 bizType 仅一条，已存在 → 409） ============
export const createApprovalConfig = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = approvalConfigService.approvalConfigCreateSchema.parse(req.body);
    created(res, await approvalConfigService.create(body));
  } catch (err) {
    respondError(res, err);
  }
};

// ============ 更新（不存在 → 404） ============
export const updateApprovalConfig = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const bizType = parseBizTypeParam(req.params.bizType);
    if (!bizType) {
      fail(res, 400, '不支持的审批业务类型');
      return;
    }
    const body = approvalConfigService.approvalConfigUpdateSchema.parse(req.body);
    success(res, await approvalConfigService.update(bizType as never, body), '更新成功');
  } catch (err) {
    respondError(res, err);
  }
};

// ============ 删除（不存在 → 404） ============
export const removeApprovalConfig = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const bizType = parseBizTypeParam(req.params.bizType);
    if (!bizType) {
      fail(res, 400, '不支持的审批业务类型');
      return;
    }
    await approvalConfigService.remove(bizType as never);
    success(res, null, '删除成功');
  } catch (err) {
    respondError(res, err);
  }
};
