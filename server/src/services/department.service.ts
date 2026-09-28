import { z } from 'zod';
import { DomainConflictError, DomainNotFoundError } from '../lib/errors';
import { departmentRepository } from '../repositories';

/**
 * Department Business Layer —— Round R-5 · Phase 4 · D4-a1 组织与权限主数据域
 *
 * 纯主数据：**零事务、零 Scope、零跨域**（Master Plan §13：不制造空壳 Operation）。
 *
 * 约束：不读 req / res、不返回 HTTP、不出现 `$transaction`、不直接 import Prisma 单例。
 */

export const departmentSchema = z.object({
  name: z.string().min(1).max(50),
  code: z.string().min(1).max(50),
  parentId: z.string().nullable().optional(),
  leader: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  sort: z.number().optional().default(0),
  status: z.number().optional().default(1),
});

export type DepartmentInput = z.infer<typeof departmentSchema>;

/** 部门列表（含用户计数） */
export function list() {
  return departmentRepository.findManyWithUserCount();
}

/**
 * 部门树。
 *
 * 【既有契约，逐字保留】本端点当前返回的是与「部门列表」**完全相同**的**扁平列表**
 * （含 `_count.users`），层级由前端组装（`utils/deptTree.ts` 的组织树推导属 Scope 能力，
 * 不用于本端点）。本轮**不改变该行为** —— 若需改为服务端建树，属独立 API 变更轮次。
 */
export function tree() {
  return departmentRepository.findManyWithUserCount();
}

/** 单个部门（含用户计数） */
export async function getOne(id: string) {
  const department = await departmentRepository.findByIdWithUserCount(id);
  if (!department) throw new DomainNotFoundError('部门不存在');
  return department;
}

/** 创建部门（编码唯一） */
export async function create(data: DepartmentInput) {
  const existing = await departmentRepository.findByCode(data.code);
  if (existing) throw new DomainConflictError('部门编码已存在');
  return departmentRepository.create(data);
}

/** 更新部门（部分更新；沿用既有行为 —— 仅按 id 定位，不额外查重） */
export function update(id: string, data: Partial<DepartmentInput>) {
  return departmentRepository.update(id, data);
}

/** 删除部门 */
export function remove(id: string) {
  return departmentRepository.delete(id);
}
