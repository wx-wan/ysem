import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { DomainConflictError, DomainNotFoundError, DomainValidationError } from '../lib/errors';
import { userRepository } from '../repositories';
import { pushNotification } from '../notification';

/**
 * User Business Layer —— Round R-5 · Phase 4 · D4-a2 账号与角色域
 *
 * 密码存储策略（bcrypt cost 12）属**业务规则**，落在本层；哈希为不可逆，故只支持重置。
 * 「角色变更 → 通知新角色下全体成员刷新会话」为本域业务事件（非跨域事务）。
 *
 * 约束：不读 req / res、不返回 HTTP、不出现 `$transaction`、不直接 import Prisma 单例。
 */

export const createUserSchema = z.object({
  username: z.string().min(2).max(50),
  password: z.string().min(6).max(100),
  realName: z.string().min(1).max(50),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  roleId: z.string().optional().nullable(),
  departmentId: z.string().optional().nullable(),
});

export const updateUserSchema = z.object({
  realName: z.string().min(1).max(50).optional(),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  avatar: z.string().optional().nullable(),
  status: z.enum(['ACTIVE', 'DISABLED', 'LOCKED']).optional(),
  roleId: z.string().optional().nullable(),
  departmentId: z.string().optional().nullable(),
});

export const resetPasswordSchema = z.object({
  password: z.string().min(6).max(100),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

/** 受保护的内置角色码（其账号不可删除） */
const PROTECTED_ROLE_CODE = 'admin';

/** bcrypt 代价因子（既有实现：12） */
const BCRYPT_ROUNDS = 12;

/** 用户列表（分页 + keyword + status） */
export async function list(query: {
  page?: string;
  pageSize?: string;
  keyword?: string;
  status?: string;
}) {
  const page = query.page ?? '1';
  const pageSize = query.pageSize ?? '10';
  const keyword = query.keyword ?? '';
  const skip = (Number(page) - 1) * Number(pageSize);
  const take = Number(pageSize);

  const where: Record<string, unknown> = {};
  if (keyword) {
    where.OR = [
      { username: { contains: keyword } },
      { realName: { contains: keyword } },
      { email: { contains: keyword } },
    ];
  }
  if (query.status) where.status = query.status;

  const [users, total] = await Promise.all([
    userRepository.findManyForAdminList(where as never, skip, take),
    userRepository.countWhere(where as never),
  ]);
  return { list: users, total, page: Number(page), pageSize: Number(pageSize) };
}

/**
 * 轻量用户列表：仅返回 id/realName/username，供产品可见性等场景选择指定人。
 * 不要求 system:user 权限，所有登录用户均可访问。
 */
export function listForSelect() {
  return userRepository.findForSelect();
}

/** 单个用户 */
export async function getOne(id: string) {
  const user = await userRepository.findByIdWithRelations(id);
  if (!user) throw new DomainNotFoundError('用户不存在');
  return user;
}

/** 创建用户（用户名唯一；密码以 bcrypt 存储） */
export async function create(data: CreateUserInput, actorId: string | undefined) {
  const existing = await userRepository.findIdByUsername(data.username);
  if (existing) throw new DomainConflictError('用户名已存在');

  const hashedPassword = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
  return userRepository.createForAdmin({
    username: data.username,
    password: hashedPassword,
    realName: data.realName,
    email: data.email,
    phone: data.phone,
    roleId: data.roleId,
    departmentId: data.departmentId,
    createdBy: actorId,
  });
}

/**
 * 更新用户（部分更新）。
 * 角色变更（`roleId` 为真值）→ 通知该**新角色**下全体成员刷新权限会话。
 * 注：既有实现的判定为 `if (data.roleId)`（真值判定，非 `!== undefined`），逐字保留。
 */
export async function update(id: string, data: UpdateUserInput) {
  const user = await userRepository.updateForAdmin(id, data);
  if (data.roleId) {
    const affected = await userRepository.findIdsByRoleId(data.roleId);
    await Promise.all(
      affected.map((u) =>
        pushNotification({
          userId: u.id,
          type: 'PERM_CHANGED',
          title: '权限已变更',
          body: '您的角色或所属角色权限已更新',
          payload: { roleId: data.roleId },
        }),
      ),
    );
  }
  return user;
}

/** 删除用户（内置 `admin` 角色的账号受保护） */
export async function remove(id: string): Promise<void> {
  const target = await userRepository.findByIdWithRole(id);
  if (!target) throw new DomainNotFoundError('用户不存在');
  if (target.role?.code === PROTECTED_ROLE_CODE) {
    throw new DomainValidationError('超级管理员账号不可删除');
  }
  await userRepository.delete(id);
}

/**
 * 重置用户密码。
 *
 * 既有实现会在写回时**原样带上** `lastLoginAt`（即不变更该字段），本轮逐字保留该写法
 * —— 不加"顺手优化"，避免引入未被要求的登录时间语义变化。
 */
export async function resetPassword(id: string, password: string): Promise<void> {
  const existing = await userRepository.findById(id);
  if (!existing) throw new DomainNotFoundError('用户不存在');

  const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await userRepository.updatePassword(id, hashedPassword, existing.lastLoginAt);
}
