import { z } from 'zod';
import { DomainConflictError } from '../lib/errors';
import { permissionRepository } from '../repositories';

/**
 * Permission Business Layer —— Round R-5 · Phase 4 · D4-a1 组织与权限主数据域
 *
 * 纯主数据：**零事务、零 Scope、零跨域** —— 单域读写在 Business 内直接调用 Data
 * （Master Plan §13：不因「看起来该有 Operation」而制造空壳）。
 *
 * 约束：不读 req / res、不返回 HTTP、不出现 `$transaction`、不直接 import Prisma 单例。
 */

export const permissionSchema = z.object({
  name: z.string().min(1).max(50),
  code: z.string().min(1).max(100),
  type: z.enum(['MENU', 'BUTTON', 'API']).optional().default('BUTTON'),
  parentId: z.string().nullable().optional(),
  sort: z.number().optional().default(0),
  path: z.string().optional().nullable(),
  icon: z.string().optional().nullable(),
});

export type PermissionInput = z.infer<typeof permissionSchema>;

/** 权限列表 */
export function list() {
  return permissionRepository.findMany();
}

interface PermissionNode {
  id: string;
  parentId: string | null;
  children: PermissionNode[];
  [key: string]: unknown;
}

/**
 * 权限树（按 `parentId` 组装层级）。
 *
 * 语义逐字沿用：先建立全量节点索引，再按「父节点是否存在于索引中」归入父级或根集合；
 * **父节点缺失（悬空 parentId）的节点视为根**。同级顺序即查询顺序（`sort` 升序，`id` 并列）。
 */
export async function tree() {
  const permissions = await permissionRepository.findManyForTree();
  const map = new Map<string, PermissionNode>();
  permissions.forEach((p) => map.set(p.id, { ...p, children: [] }));

  const roots: PermissionNode[] = [];
  permissions.forEach((p) => {
    const node = map.get(p.id)!;
    const parent = p.parentId ? map.get(p.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });
  return roots;
}

/** 创建权限（编码唯一） */
export async function create(data: PermissionInput) {
  const existing = await permissionRepository.findByCode(data.code);
  if (existing) throw new DomainConflictError('权限编码已存在');
  return permissionRepository.create(data);
}

/** 更新权限（部分更新；编码唯一性沿用既有行为 —— 仅按 id 定位，不额外查重） */
export function update(id: string, data: Partial<PermissionInput>) {
  return permissionRepository.update(id, data);
}

/** 删除权限 */
export function remove(id: string) {
  return permissionRepository.delete(id);
}
