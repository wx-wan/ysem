import { Response } from 'express';
import { z } from 'zod';
import { DomainError } from '../lib/errors';
import { AuthRequest } from '../middleware/auth';
import * as permissionService from '../services/permission.service';
import { created, fail, success } from '../utils/response';

/**
 * Permission Controller —— Round R-5 · Phase 4 · D4-a1 组织与权限主数据域
 *
 * 职责（仅此）：HTTP request/response、DTO 校验、错误映射。
 * **禁止** Prisma 访问 / 业务规则 —— 已在 `services/permission.service.ts`（Business）
 * / `repositories/permission.repository.ts`（Data）。API Contract 保持不变。
 *
 * 【无 Operation 层】纯主数据单域读写，无事务、无跨域协调；
 * 按 Master Plan §13 不制造空壳 Operation。
 */

function respondError(res: Response, err: unknown): void {
  if (err instanceof DomainError) {
    fail(res, err.code, err.message);
    return;
  }
  if (err instanceof z.ZodError) {
    // 既有契约：统一前缀 + 逐条 message 串联
    fail(res, 400, '参数校验失败：' + err.errors.map((e) => e.message).join(', '));
    return;
  }
  fail(res, 500, '服务器错误');
}

// 获取权限列表
export const getPermissions = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    success(res, await permissionService.list());
  } catch (err) {
    respondError(res, err);
  }
};

// 获取权限树（按 parentId 组装层级，同级按 sort 排序）
export const getPermissionTree = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    success(res, await permissionService.tree());
  } catch (err) {
    respondError(res, err);
  }
};

// 创建权限
export const createPermission = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = permissionService.permissionSchema.parse(req.body);
    created(res, await permissionService.create(data), '权限创建成功');
  } catch (err) {
    respondError(res, err);
  }
};

// 更新权限
export const updatePermission = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = permissionService.permissionSchema.partial().parse(req.body);
    success(res, await permissionService.update(req.params.id, data), '权限更新成功');
  } catch (err) {
    respondError(res, err);
  }
};

// 删除权限
export const deletePermission = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await permissionService.remove(req.params.id);
    success(res, null, '权限删除成功');
  } catch (err) {
    respondError(res, err);
  }
};
