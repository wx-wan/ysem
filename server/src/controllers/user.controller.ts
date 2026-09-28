import { Response } from 'express';
import { z } from 'zod';
import { DomainError } from '../lib/errors';
import { AuthRequest } from '../middleware/auth';
import * as userService from '../services/user.service';
import { created, fail, success } from '../utils/response';

/**
 * User Controller —— Round R-5 · Phase 4 · D4-a2 账号与角色域
 *
 * 职责（仅此）：HTTP request/response、DTO 校验、错误映射。
 * **禁止** Prisma 访问 / 密码哈希 / 业务规则 —— 已在 `services/user.service.ts`（Business：
 * bcrypt 存储策略 / 用户名唯一 / admin 账号保护 / 角色变更通知）
 * / `repositories/user.repository.ts`（Data）。
 *
 * 【无 Operation 层】本域写操作均为单表单写（零事务）；
 * 唯一的写事务（角色权限分配）在 `operations/role.operations.ts`。
 * 按 Master Plan §13 不为单表 CRUD 制造空壳 Operation。
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

// 获取用户列表
export const getUsers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, pageSize, keyword, status } = req.query as Record<string, string>;
    success(res, await userService.list({ page, pageSize, keyword, status }));
  } catch (err) {
    respondError(res, err);
  }
};

// 轻量用户列表：仅返回 id/realName/username，供产品可见性等场景选择指定人。
// 不要求 system:user 权限，所有登录用户均可访问。
export const getUsersForSelect = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    success(res, await userService.listForSelect());
  } catch (err) {
    respondError(res, err);
  }
};

// 获取单个用户
export const getUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    success(res, await userService.getOne(req.params.id));
  } catch (err) {
    respondError(res, err);
  }
};

// 创建用户
export const createUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = userService.createUserSchema.parse(req.body);
    created(res, await userService.create(data, req.userId), '用户创建成功');
  } catch (err) {
    respondError(res, err);
  }
};

// 更新用户
export const updateUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = userService.updateUserSchema.parse(req.body);
    success(res, await userService.update(req.params.id, data), '用户更新成功');
  } catch (err) {
    respondError(res, err);
  }
};

// 删除用户
export const deleteUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await userService.remove(req.params.id);
    success(res, null, '用户删除成功');
  } catch (err) {
    respondError(res, err);
  }
};

// 重置用户密码（有用户管理权限即可，原密码为 bcrypt 哈希不可逆，只能重置）
export const resetPassword = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = userService.resetPasswordSchema.parse(req.body);
    await userService.resetPassword(req.params.id, data.password);
    success(res, null, '密码重置成功');
  } catch (err) {
    respondError(res, err);
  }
};
