import { z } from 'zod';
import { DomainConflictError, DomainNotFoundError, DomainValidationError } from '../lib/errors';
import { assignPermissionsAggregate } from '../operations/role.operations';
import { roleRepository, userRepository } from '../repositories';
import { DEFAULT_DATA_SCOPE } from '../scope';
import { pushNotification } from '../notification';

/**
 * Role Business Layer —— Round R-5 · Phase 4 · D4-a2 账号与角色域
 *
 * 「权限变更 → 通知该角色下全部用户刷新会话」是**本域业务事件**（非跨域事务）：
 * 逐个写库并推送在线连接；离线用户由首连补偿拉取。保持既有实现形态不变。
 *
 * 约束：不读 req / res、不返回 HTTP、不出现 `$transaction`、不直接 import Prisma 单例。
 */

export const roleSchema = z.object({
  name: z.string().min(1).max(50),
  code: z.string().min(1).max(50),
  description: z.string().optional().nullable(),
  sort: z.number().optional().default(0),
  dataScope: z.enum(['ALL', 'DEPT', 'SELF']).optional().default(DEFAULT_DATA_SCOPE),
});

export type RoleInput = z.infer<typeof roleSchema>;

/** 受保护的内置角色码（不可删除） */
const PROTECTED_ROLE_CODE = 'admin';

/**
 * 向某角色下所有用户推送「权限已变更」通知（权限 / 数据范围变更时刷新其会话）。
 * 角色下用户可能很多，这里逐个写库并推送在线连接；离线用户由首连补偿拉取。
 */
export async function notifyRoleUsers(roleId: string, body = '您所属角色的权限或数据范围已更新') {
  const users = await userRepository.findIdsByRoleId(roleId);
  await Promise.all(
    users.map((u) =>
      pushNotification({
        userId: u.id,
        type: 'PERM_CHANGED',
        title: '权限已变更',
        body,
        payload: { roleId },
      }),
    ),
  );
}

/** 角色列表 */
export function list() {
  return roleRepository.findManyWithCounts();
}

/** 单个角色（权限明细 + 用户计数） */
export async function getOne(id: string) {
  const role = await roleRepository.findByIdWithPermissions(id);
  if (!role) throw new DomainNotFoundError('角色不存在');
  return role;
}

/** 创建角色（编码唯一） */
export async function create(data: RoleInput) {
  const existing = await roleRepository.findByCode(data.code);
  if (existing) throw new DomainConflictError('角色编码已存在');
  return roleRepository.create(data);
}

/**
 * 更新角色（部分更新）。
 * `dataScope` 显式出现时 → 通知该角色下所有用户刷新权限会话。
 * 注：`undefined` 判定沿用既有实现（`partial()` 后的字段语义），不得改为 falsy 判定。
 */
export async function update(id: string, data: Partial<RoleInput>) {
  const role = await roleRepository.update(id, data);
  if (data.dataScope !== undefined) await notifyRoleUsers(id);
  return role;
}

/** 删除角色（内置 `admin` 角色受保护） */
export async function remove(id: string): Promise<void> {
  const role = await roleRepository.findById(id);
  if (!role) throw new DomainNotFoundError('角色不存在');
  if (role.code === PROTECTED_ROLE_CODE) throw new DomainValidationError('超级管理员角色不可删除');
  await roleRepository.delete(id);
}

/**
 * 分配权限（整表重建，原子）。
 * `permissionIds` 必须为数组（DTO 级判定，文案沿用既有实现）。
 */
export async function assignPermissions(
  id: string,
  permissionIds: unknown,
): Promise<void> {
  if (!Array.isArray(permissionIds)) throw new DomainValidationError('请提供权限ID数组');
  await assignPermissionsAggregate(id, permissionIds as string[]);
  // 权限变更 → 通知该角色下所有用户刷新权限会话
  await notifyRoleUsers(id);
}
