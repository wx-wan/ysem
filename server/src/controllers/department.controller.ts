import { Response } from 'express';
import { z } from 'zod';
import { DomainError } from '../lib/errors';
import { AuthRequest } from '../middleware/auth';
import * as departmentService from '../services/department.service';
import { created, fail, success } from '../utils/response';

/**
 * Department Controller —— Round R-5 · Phase 4 · D4-a1 组织与权限主数据域
 *
 * 职责（仅此）：HTTP request/response、DTO 校验、错误映射。
 * **禁止** Prisma 访问 / 业务规则 —— 已在 `services/department.service.ts`（Business）
 * / `repositories/department.repository.ts`（Data）。API Contract 保持不变。
 *
 * 【无 Operation 层】纯主数据单域读写（零事务、零跨域），按 Master Plan §13 不制造空壳。
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

// 获取部门列表
export const getDepartments = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    success(res, await departmentService.list());
  } catch (err) {
    respondError(res, err);
  }
};

// 获取部门树（既有契约：返回与列表相同的扁平结构，层级由前端组装）
export const getDeptTree = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    success(res, await departmentService.tree());
  } catch (err) {
    respondError(res, err);
  }
};

// 获取单个部门
export const getDepartment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    success(res, await departmentService.getOne(req.params.id));
  } catch (err) {
    respondError(res, err);
  }
};

// 创建部门
export const createDepartment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = departmentService.departmentSchema.parse(req.body);
    created(res, await departmentService.create(data), '部门创建成功');
  } catch (err) {
    respondError(res, err);
  }
};

// 更新部门
export const updateDepartment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = departmentService.departmentSchema.partial().parse(req.body);
    success(res, await departmentService.update(req.params.id, data), '部门更新成功');
  } catch (err) {
    respondError(res, err);
  }
};

// 删除部门
export const deleteDepartment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await departmentService.remove(req.params.id);
    success(res, null, '部门删除成功');
  } catch (err) {
    respondError(res, err);
  }
};
