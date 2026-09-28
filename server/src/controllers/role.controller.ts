import { Response } from 'express';
import { z } from 'zod';
import { DomainError } from '../lib/errors';
import { AuthRequest } from '../middleware/auth';
import * as roleService from '../services/role.service';
import { created, fail, success } from '../utils/response';

/**
 * Role Controller —— Round R-5 · Phase 4 · D4-a2 账号与角色域
 *
 * 职责（仅此）：HTTP request/response、DTO 校验、错误映射。
 * **禁止** Prisma 访问 / 事务 / 业务规则 —— 已在
 *   `services/role.service.ts`（Business：编码唯一 / admin 角色保护 / 权限变更通知）
 *   `operations/role.operations.ts`（Operation：角色权限关联整表重建事务）
 *   `repositories/role.repository.ts`（Data）。API Contract 保持不变。
 */

function respondError(res: Response, err: unknown): void {
  if (err instanceof DomainError) {
    fail(res, err.code, err.message);
    return;
  }
  if (err instanceof z.ZodError) {
    fail(res, 400, '参数校验失败：' + err.errors.map((e) => e.message).join(', '));
    return;
  }
  fail(res, 500, '服务器错误');
}

// 获取角色列表
export const getRoles = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    success(res, await roleService.list());
  } catch (err) {
    respondError(res, err);
  }
};

// 获取单个角色
export const getRole = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    success(res, await roleService.getOne(req.params.id));
  } catch (err) {
    respondError(res, err);
  }
};

// 创建角色
export const createRole = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = roleService.roleSchema.parse(req.body);
    created(res, await roleService.create(data), '角色创建成功');
  } catch (err) {
    respondError(res, err);
  }
};

// 更新角色
export const updateRole = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = roleService.roleSchema.partial().parse(req.body);
    success(res, await roleService.update(req.params.id, data), '角色更新成功');
  } catch (err) {
    respondError(res, err);
  }
};

// 删除角色
export const deleteRole = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await roleService.remove(req.params.id);
    success(res, null, '角色删除成功');
  } catch (err) {
    respondError(res, err);
  }
};

// 分配权限
export const assignPermissions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { permissionIds } = req.body as { permissionIds: string[] };
    await roleService.assignPermissions(req.params.id, permissionIds);
    success(res, null, '权限分配成功');
  } catch (err) {
    respondError(res, err);
  }
};
